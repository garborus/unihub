// Instala e remove o efeito de áudio do UnusHub no microfone (efeito-unushub.exe).
//
// Uso: efeito-unushub.exe --instalar {id do microfone}
//      efeito-unushub.exe --remover
// Saída: 0 feito, 1 falhou, 1223 a pessoa recusou o pedido de administrador, 2 uso
// errado. O texto (o que foi feito, ou o motivo da falha) sai na saída padrão, em UTF-8.
//
// Precisa de administrador. Aberto sem ele, o programa confere o que dá para conferir,
// pede a permissão ao Windows (reabrindo a si mesmo) e repassa o resultado.
//
// Instalar, na ordem:
//  1. Copia a DLL (a que está na pasta deste programa, nunca um caminho recebido) para a
//     pasta de programas do Windows (Program Files\UniHub\audio-mix).
//  2. Registra a DLL como componente COM e como efeito de áudio do Windows.
//  3. Guarda a lista atual de efeitos de ponta do microfone numa cópia (só na primeira vez).
//  4. Acrescenta o efeito no fim dessa lista (os que já estão lá continuam). O efeito de
//     ponta é o primeiro da cadeia e vale para todos os apps e modos do microfone,
//     inclusive o "bruto" que apps de chamada usam e que pula os efeitos de fluxo.
//  5. Liga as "melhorias de áudio" do microfone, se estavam desligadas (com cópia): sem
//     elas o Windows não roda nenhum efeito.
//  6. Desfaz o que versões antigas faziam na lista de efeitos de fluxo.
//  7. Reinicia o serviço de áudio do Windows (o som de todos os apps para por uns segundos).
// Se algo falhar depois de o serviço de áudio ter sido parado, ele é religado mesmo assim.
//
// Remover devolve a lista de efeitos original de cada microfone em que o efeito estava,
// apaga o registro e a pasta. Um microfone que não puder ser aberto não impede os outros.
//
// As cópias (backup-*.json) têm o mesmo formato das versões antigas, que instalavam por
// scripts do PowerShell: {"existia":true,"valor":["{...}"]}.
//
// Com INSTALADOR_TESTE definido, tudo acontece numa chave de rascunho do usuário e numa
// pasta temporária, sem administrador e sem tocar no som (só para os testes).

#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <aclapi.h>
#include <bcrypt.h>
#include <string>
#include <vector>
#include "../comum/canal.h"

static const wchar_t* const CLSID_EFEITO = EFEITO_CLSID_TEXTO;
static const wchar_t* const GUID_NULO = L"{00000000-0000-0000-0000-000000000000}";
static const wchar_t* const NOME_DLL = L"UniHubAudioMix.dll";
// Valores na chave FxProperties do microfone.
static const wchar_t* const EFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15";        // lista de efeitos de ponta (todos os modos)
static const wchar_t* const EFX_ANTIGO = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},7";  // efeito de ponta no formato antigo (um só)
static const wchar_t* const SFX = L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13";        // lista de efeitos de fluxo (versões antigas)
static const wchar_t* const MODOS = L"{d3993a3f-99c2-4402-b5ec-a92a0367664b},5";       // modos dos efeitos de fluxo (versões antigas)
static const wchar_t* const MELHORIAS = L"{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5";   // 1 = "melhorias de áudio" desligadas
// Valor na chave Properties: quem criou o aparelho (USB, BTHHFENUM…).
static const wchar_t* const BARRAMENTO = L"{a45c254e-df1c-4efd-8020-67d146a850e0},24";
static const wchar_t* const PIPE_PREFIXO = L"\\\\.\\pipe\\UnusHubEfeito-";

// Onde o programa mexe. Um só lugar de verdade; os testes usam outro.
struct Lugar {
  HKEY raiz = HKEY_LOCAL_MACHINE;
  std::wstring capturas;  // chave dos microfones
  std::wstring classes;   // chave dos componentes
  std::wstring pasta;     // onde a DLL fica instalada
  std::wstring diag;      // pasta do registro de diagnóstico da DLL
  std::wstring origem;    // pasta deste programa (onde está a DLL a instalar)
  bool sistema = true;    // exige administrador e mexe no serviço de áudio
};

struct Falha { std::wstring texto; };
[[noreturn]] static void Falhar(const std::wstring& texto) { throw Falha{ texto }; }
static std::wstring Erro(LONG codigo) { return L" (erro " + std::to_wstring(codigo) + L")"; }

static std::wstring g_saida; // o que vai para o app, uma linha por fato
static void Dizer(const std::wstring& linha) { g_saida += linha; g_saida += L"\n"; }

static std::string Utf8(const std::wstring& w) {
  if (w.empty()) return "";
  const int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string s(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), &s[0], n, nullptr, nullptr);
  return s;
}

static bool MesmoTexto(const std::wstring& a, const wchar_t* b) { return _wcsicmp(a.c_str(), b) == 0; }

// "{" + 36 letras de GUID + "}".
static bool EhGuid(const std::wstring& s) {
  if (s.size() != 38 || s.front() != L'{' || s.back() != L'}') return false;
  for (size_t i = 1; i < 37; i++) {
    const wchar_t c = s[i];
    if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f') || (c >= L'A' && c <= L'F') || c == L'-')) return false;
  }
  return true;
}

static bool Existe(const std::wstring& caminho) { return GetFileAttributesW(caminho.c_str()) != INVALID_FILE_ATTRIBUTES; }

// --- Registro ------------------------------------------------------------------------

struct Chave {
  HKEY h = nullptr;
  Chave() = default;
  Chave(const Chave&) = delete;
  Chave& operator=(const Chave&) = delete;
  ~Chave() { if (h) RegCloseKey(h); }
};

// Lista de GUIDs de um valor do registro. false: o valor não existe.
// Separa também GUIDs que tenham sido gravados colados ("}{").
static bool LerLista(HKEY k, const wchar_t* nome, std::vector<std::wstring>& itens) {
  itens.clear();
  DWORD bytes = 0;
  LONG r = RegGetValueW(k, nullptr, nome, RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ, nullptr, nullptr, &bytes);
  if (r == ERROR_FILE_NOT_FOUND) return false;
  if (r != ERROR_SUCCESS) Falhar(L"Não foi possível ler os efeitos do microfone" + Erro(r) + L".");
  std::vector<wchar_t> buf(bytes / sizeof(wchar_t) + 2, L'\0'); // sobra de zeros: o fim da lista
  r = RegGetValueW(k, nullptr, nome, RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ, nullptr, buf.data(), &bytes);
  if (r != ERROR_SUCCESS) Falhar(L"Não foi possível ler os efeitos do microfone" + Erro(r) + L".");
  for (const wchar_t* p = buf.data(); *p; p += wcslen(p) + 1) {
    const std::wstring s = p;
    size_t ini = 0;
    for (size_t i = 0; i + 1 < s.size(); i++) {
      if (s[i] == L'}' && s[i + 1] == L'{') { itens.push_back(s.substr(ini, i + 1 - ini)); ini = i + 1; }
    }
    itens.push_back(s.substr(ini));
  }
  return true;
}

static void GravarLista(HKEY k, const wchar_t* nome, const std::vector<std::wstring>& itens) {
  std::vector<wchar_t> dados;
  for (const std::wstring& s : itens) { dados.insert(dados.end(), s.begin(), s.end()); dados.push_back(L'\0'); }
  dados.push_back(L'\0');
  const LONG r = RegSetValueExW(k, nome, 0, REG_MULTI_SZ, reinterpret_cast<const BYTE*>(dados.data()), static_cast<DWORD>(dados.size() * sizeof(wchar_t)));
  if (r != ERROR_SUCCESS) Falhar(L"O Windows não deixou gravar os efeitos do microfone" + Erro(r) + L".");
}

static void ApagarValor(HKEY k, const wchar_t* nome) {
  const LONG r = RegDeleteValueW(k, nome);
  if (r != ERROR_SUCCESS && r != ERROR_FILE_NOT_FOUND) Falhar(L"O Windows não deixou apagar um valor dos efeitos do microfone" + Erro(r) + L".");
}

// Lista vazia não fica gravada: o valor some.
static void GravarOuApagar(HKEY k, const wchar_t* nome, const std::vector<std::wstring>& itens) {
  if (itens.empty()) ApagarValor(k, nome); else GravarLista(k, nome, itens);
}

static bool LerNumero(HKEY k, const wchar_t* nome, DWORD& v) {
  DWORD tam = sizeof(v);
  return RegGetValueW(k, nullptr, nome, RRF_RT_REG_DWORD, nullptr, &v, &tam) == ERROR_SUCCESS;
}

static void GravarNumero(HKEY k, const wchar_t* nome, DWORD v) {
  const LONG r = RegSetValueExW(k, nome, 0, REG_DWORD, reinterpret_cast<const BYTE*>(&v), sizeof(v));
  if (r != ERROR_SUCCESS) Falhar(L"O Windows não deixou gravar as melhorias de áudio do microfone" + Erro(r) + L".");
}

static bool LerTexto(HKEY k, const wchar_t* nome, std::wstring& texto) {
  wchar_t buf[512];
  DWORD tam = sizeof(buf);
  if (RegGetValueW(k, nullptr, nome, RRF_RT_REG_SZ, nullptr, buf, &tam) != ERROR_SUCCESS) return false;
  texto = buf;
  return true;
}

static void GravarTexto(HKEY k, const wchar_t* nome, const std::wstring& texto) {
  const LONG r = RegSetValueExW(k, nome, 0, REG_SZ, reinterpret_cast<const BYTE*>(texto.c_str()), static_cast<DWORD>((texto.size() + 1) * sizeof(wchar_t)));
  if (r != ERROR_SUCCESS) Falhar(L"O Windows não deixou registrar o efeito" + Erro(r) + L".");
}

static void CriarChave(const Lugar& l, const std::wstring& caminho, Chave& k) {
  const LONG r = RegCreateKeyExW(l.raiz, caminho.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &k.h, nullptr);
  if (r != ERROR_SUCCESS) Falhar(L"O Windows não deixou registrar o efeito" + Erro(r) + L".");
}

static bool TemEfeito(const std::vector<std::wstring>& itens) {
  for (const std::wstring& s : itens) if (MesmoTexto(s, CLSID_EFEITO)) return true;
  return false;
}

static std::vector<std::wstring> SemEfeito(const std::vector<std::wstring>& itens) {
  std::vector<std::wstring> out;
  for (const std::wstring& s : itens) if (!s.empty() && !MesmoTexto(s, CLSID_EFEITO)) out.push_back(s);
  return out;
}

// --- Cópias do que o microfone tinha antes (backup-*.json) -----------------------------

struct Copia {
  bool existia = false;            // o valor existia no registro
  std::vector<std::wstring> valor; // textos (GUIDs) ou um número
};

static bool LerArquivo(const std::wstring& caminho, std::string& bytes) {
  const HANDLE f = CreateFileW(caminho.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) return false;
  bytes.clear();
  char buf[4096];
  DWORD n = 0;
  while (ReadFile(f, buf, sizeof(buf), &n, nullptr) && n && bytes.size() < (1u << 20)) bytes.append(buf, n);
  CloseHandle(f);
  return true;
}

// false: não há cópia. Lê o formato fixo que este programa e os scripts antigos gravam.
static bool LerCopia(const std::wstring& arquivo, Copia& c) {
  std::string t;
  if (!LerArquivo(arquivo, t)) return false;
  c = Copia();
  const auto pular = [&t](size_t p) { while (p < t.size() && (t[p] == ' ' || t[p] == '\t' || t[p] == '\r' || t[p] == '\n' || t[p] == ',')) p++; return p; };
  size_t p = t.find("\"existia\"");
  if (p == std::string::npos || (p = t.find(':', p)) == std::string::npos) Falhar(L"A cópia dos efeitos do microfone está ilegível: " + arquivo);
  c.existia = t.compare(pular(p + 1), 4, "true") == 0;
  p = t.find("\"valor\"");
  if (p == std::string::npos || (p = t.find(':', p)) == std::string::npos) return true;
  p = pular(p + 1);
  const bool lista = p < t.size() && t[p] == '[';
  if (lista) p++;
  for (;;) {
    p = pular(p);
    if (p >= t.size()) break;
    size_t fim = p;
    std::string item;
    if (t[p] == '"') {
      fim = t.find('"', p + 1);
      if (fim == std::string::npos) break;
      item = t.substr(p + 1, fim - p - 1);
      fim++;
    } else {
      while (fim < t.size() && ((t[fim] >= '0' && t[fim] <= '9') || t[fim] == '-')) fim++;
      if (fim == p) break; // "]", "}" ou algo que não é item
      item = t.substr(p, fim - p);
    }
    c.valor.push_back(std::wstring(item.begin(), item.end())); // só GUIDs e números: ASCII
    p = fim;
    if (!lista) break;
  }
  return true;
}

// Guarda só na primeira vez: a cópia é de como o microfone era antes do efeito.
static void GuardarCopia(const std::wstring& arquivo, const Copia& c, bool numero = false) {
  std::string t = c.existia ? "{\"existia\":true,\"valor\":[" : "{\"existia\":false";
  if (c.existia) {
    for (size_t i = 0; i < c.valor.size(); i++) {
      const std::string item = Utf8(c.valor[i]);
      t += (i ? "," : "") + (numero ? item : "\"" + item + "\"");
    }
    t += "]";
  }
  t += "}\r\n";
  const HANDLE f = CreateFileW(arquivo.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_FILE_EXISTS) return;
    Falhar(L"Não foi possível guardar a cópia dos efeitos do microfone" + Erro(static_cast<LONG>(GetLastError())) + L".");
  }
  DWORD n = 0;
  const bool ok = WriteFile(f, t.data(), static_cast<DWORD>(t.size()), &n, nullptr) && n == t.size();
  CloseHandle(f);
  if (!ok) { DeleteFileW(arquivo.c_str()); Falhar(L"Não foi possível guardar a cópia dos efeitos do microfone."); }
}

// Devolve ao registro o que a cópia guardou.
static void Restaurar(HKEY k, const wchar_t* nome, const Copia& c) {
  if (c.existia) GravarLista(k, nome, c.valor); else ApagarValor(k, nome);
}

// --- Serviço de áudio do Windows -------------------------------------------------------

static std::vector<std::wstring> g_dependentes; // serviços parados junto com o de áudio, para religar

static bool EsperarEstado(SC_HANDLE svc, DWORD estado, DWORD ms) {
  SERVICE_STATUS st = {};
  for (DWORD passou = 0; passou <= ms; passou += 100) {
    if (!QueryServiceStatus(svc, &st)) return false;
    if (st.dwCurrentState == estado) return true;
    Sleep(100);
  }
  return false;
}

// Para um serviço e, antes, os que dependem dele e estão rodando.
static bool PararServico(SC_HANDLE scm, const wchar_t* nome, bool dependente) {
  const SC_HANDLE svc = OpenServiceW(scm, nome, SERVICE_STOP | SERVICE_QUERY_STATUS | SERVICE_ENUMERATE_DEPENDENTS);
  if (!svc) return false;
  DWORD bytes = 0, quantos = 0;
  if (!EnumDependentServicesW(svc, SERVICE_ACTIVE, nullptr, 0, &bytes, &quantos) && GetLastError() == ERROR_MORE_DATA) {
    std::vector<BYTE> buf(bytes);
    ENUM_SERVICE_STATUSW* lista = reinterpret_cast<ENUM_SERVICE_STATUSW*>(buf.data());
    if (EnumDependentServicesW(svc, SERVICE_ACTIVE, lista, bytes, &bytes, &quantos)) {
      for (DWORD i = 0; i < quantos; i++) PararServico(scm, lista[i].lpServiceName, true);
    }
  }
  SERVICE_STATUS st = {};
  bool parado = QueryServiceStatus(svc, &st) && st.dwCurrentState == SERVICE_STOPPED;
  if (!parado) {
    ControlService(svc, SERVICE_CONTROL_STOP, &st); // se já estava parando, a espera abaixo resolve
    parado = EsperarEstado(svc, SERVICE_STOPPED, 20000);
    if (parado && dependente) g_dependentes.push_back(nome);
  }
  CloseServiceHandle(svc);
  return parado;
}

static bool IniciarServico(SC_HANDLE scm, const wchar_t* nome) {
  const SC_HANDLE svc = OpenServiceW(scm, nome, SERVICE_START | SERVICE_QUERY_STATUS);
  if (!svc) return false;
  bool ok = StartServiceW(svc, 0, nullptr) || GetLastError() == ERROR_SERVICE_ALREADY_RUNNING;
  ok = ok && EsperarEstado(svc, SERVICE_RUNNING, 20000);
  CloseServiceHandle(svc);
  return ok;
}

static bool PararAudio(const Lugar& l) {
  if (!l.sistema) return true;
  const SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
  if (!scm) return false;
  const bool ok = PararServico(scm, L"Audiosrv", false);
  CloseServiceHandle(scm);
  return ok;
}

// Reinicia (ou só religa) o serviço de áudio; tenta algumas vezes. Devolve se deu certo.
static bool ReiniciarAudio(const Lugar& l) {
  if (!l.sistema) return true;
  const SC_HANDLE scm = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
  if (!scm) return false;
  bool ok = false;
  for (int i = 0; i < 3 && !ok; i++) {
    ok = PararServico(scm, L"Audiosrv", false) && IniciarServico(scm, L"Audiosrv");
    if (!ok) Sleep(1000);
  }
  // Na ordem inversa da parada. Se um não voltar, o Windows o religa quando precisar.
  for (size_t i = g_dependentes.size(); i-- > 0;) IniciarServico(scm, g_dependentes[i].c_str());
  g_dependentes.clear();
  CloseServiceHandle(scm);
  return ok;
}

// --- Arquivos ------------------------------------------------------------------------

static void CriarPasta(const std::wstring& pasta) {
  const int r = SHCreateDirectoryExW(nullptr, pasta.c_str(), nullptr);
  const DWORD atributos = GetFileAttributesW(pasta.c_str());
  if ((r != ERROR_SUCCESS && r != ERROR_ALREADY_EXISTS && r != ERROR_FILE_EXISTS) || atributos == INVALID_FILE_ATTRIBUTES || !(atributos & FILE_ATTRIBUTE_DIRECTORY)) {
    Falhar(L"Não foi possível criar a pasta " + pasta + Erro(r) + L".");
  }
}

// Apaga a pasta com o que tem dentro. Devolve se ela sumiu.
static bool ApagarPasta(const std::wstring& pasta) {
  WIN32_FIND_DATAW d;
  const HANDLE h = FindFirstFileW((pasta + L"\\*").c_str(), &d);
  if (h != INVALID_HANDLE_VALUE) {
    do {
      if (!wcscmp(d.cFileName, L".") || !wcscmp(d.cFileName, L"..")) continue;
      const std::wstring item = pasta + L"\\" + d.cFileName;
      // Atalho de pasta (junção): apaga só o atalho, nunca o que ele aponta.
      if ((d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) && !(d.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) ApagarPasta(item);
      else if (d.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) RemoveDirectoryW(item.c_str());
      else DeleteFileW(item.c_str());
    } while (FindNextFileW(h, &d));
    FindClose(h);
  }
  RemoveDirectoryW(pasta.c_str());
  return !Existe(pasta);
}

// Dá ao Serviço Local (quem roda a DLL dentro do serviço de áudio) permissão de
// modificar a pasta do registro de diagnóstico.
static void LiberarParaServicoLocal(const std::wstring& pasta) {
  BYTE sid[SECURITY_MAX_SID_SIZE];
  DWORD tam = sizeof(sid);
  if (!CreateWellKnownSid(WinLocalServiceSid, nullptr, sid, &tam)) return;
  PACL atual = nullptr, novo = nullptr;
  PSECURITY_DESCRIPTOR sd = nullptr;
  if (GetNamedSecurityInfoW(pasta.c_str(), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &atual, nullptr, &sd) != ERROR_SUCCESS) return;
  EXPLICIT_ACCESSW ea = {};
  ea.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE | DELETE;
  ea.grfAccessMode = GRANT_ACCESS;
  ea.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
  ea.Trustee.TrusteeForm = TRUSTEE_IS_SID;
  ea.Trustee.TrusteeType = TRUSTEE_IS_WELL_KNOWN_GROUP;
  ea.Trustee.ptstrName = reinterpret_cast<LPWSTR>(sid);
  if (SetEntriesInAclW(1, &ea, atual, &novo) == ERROR_SUCCESS) {
    SetNamedSecurityInfoW(const_cast<LPWSTR>(pasta.c_str()), SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, novo, nullptr);
    LocalFree(novo);
  }
  LocalFree(sd);
}

// --- Conferências ---------------------------------------------------------------------

static bool Arm64() {
  typedef BOOL (WINAPI* Fn)(HANDLE, USHORT*, USHORT*);
  const Fn fn = reinterpret_cast<Fn>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2"));
  USHORT processo = 0, maquina = 0;
  return fn && fn(GetCurrentProcess(), &processo, &maquina) && maquina == IMAGE_FILE_MACHINE_ARM64;
}

static bool Administrador() {
  BYTE sid[SECURITY_MAX_SID_SIZE];
  DWORD tam = sizeof(sid);
  BOOL membro = FALSE;
  return CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, sid, &tam) && CheckTokenMembership(nullptr, sid, &membro) && membro;
}

// O que dá para saber antes de mudar qualquer coisa (e antes de pedir administrador).
static void Conferir(const Lugar& l, const std::wstring& mic) {
  if (!EhGuid(mic)) Falhar(L"Microfone inválido: " + mic);
  if (!Existe(l.origem + L"\\" + NOME_DLL)) Falhar(L"O arquivo do efeito não foi encontrado em " + l.origem + L".");
  // A DLL é x64: num Windows ARM64 o serviço de áudio não consegue carregá-la.
  if (l.sistema && Arm64()) Falhar(L"O efeito no microfone ainda não funciona em computadores com processador ARM. Use um cabo de áudio virtual.");
  const std::wstring base = l.capturas + L"\\" + mic;
  Chave fx;
  if (RegOpenKeyExW(l.raiz, (base + L"\\FxProperties").c_str(), 0, KEY_QUERY_VALUE, &fx.h) != ERROR_SUCCESS) {
    Falhar(L"O microfone não foi encontrado no Windows (ele pode ter sido desligado). Feche e abra a aba Sons e tente de novo.");
  }
  // Microfone de fone Bluetooth: o Windows não roda efeitos nele.
  Chave props;
  std::wstring barramento;
  if (RegOpenKeyExW(l.raiz, (base + L"\\Properties").c_str(), 0, KEY_QUERY_VALUE, &props.h) == ERROR_SUCCESS
      && LerTexto(props.h, BARRAMENTO, barramento) && _wcsnicmp(barramento.c_str(), L"BTH", 3) == 0) {
    Falhar(L"Este microfone é de um fone Bluetooth, e nele o Windows não roda efeitos. Use o fone pelo cabo ou pelo dongle, ou um cabo de áudio virtual.");
  }
}

// --- Instalar ------------------------------------------------------------------------

static std::wstring Juntar(const std::vector<std::wstring>& itens) {
  std::wstring out;
  for (size_t i = 0; i < itens.size(); i++) out += (i ? L", " : L"") + itens[i];
  return out;
}

// Passos 1 a 6. audioParado avisa quem chamou que o serviço de áudio ficou desligado.
static std::vector<std::wstring> InstalarPassos(const Lugar& l, const std::wstring& mic, bool& audioParado) {
  const std::wstring destino = l.pasta + L"\\" + NOME_DLL;
  const std::wstring origem = l.origem + L"\\" + NOME_DLL;
  const std::wstring curto = mic.substr(1, 36);

  // 1. DLL. Se o serviço de áudio já carregou uma versão anterior, ela está em uso:
  //    para o serviço e tenta de novo por alguns segundos (ele volta no fim).
  CriarPasta(l.pasta);
  if (!CopyFileW(origem.c_str(), destino.c_str(), FALSE)) {
    PararAudio(l);
    audioParado = true;
    bool copiou = false;
    DWORD erro = 0;
    for (int i = 0; i < 10 && !copiou; i++) {
      copiou = CopyFileW(origem.c_str(), destino.c_str(), FALSE) != 0;
      if (!copiou) { erro = GetLastError(); Sleep(500); }
    }
    if (!copiou) {
      Falhar(L"Não foi possível trocar o arquivo do efeito, porque ele está em uso" + Erro(static_cast<LONG>(erro))
        + L". Feche os apps que usam o microfone e tente de novo, ou reinicie o computador.");
    }
  }

  // Versão do efeito instalado (versao.txt, um número que sobe quando a DLL muda): o app
  // compara com a que veio nele e oferece "Atualizar efeito". Sem o arquivo, vale 1.
  const std::wstring versao = l.origem + L"\\..\\versao.txt";
  if (Existe(versao)) CopyFileW(versao.c_str(), (l.pasta + L"\\versao.txt").c_str(), FALSE);

  // Registro de diagnóstico da DLL, com escrita liberada para o Serviço Local. Fica
  // desligado: só registra se existir o arquivo log-ligado nessa pasta. O registro
  // antigo é apagado. Se esta parte falhar, a instalação segue: é só diagnóstico.
  if (SHCreateDirectoryExW(nullptr, l.diag.c_str(), nullptr) == ERROR_SUCCESS || Existe(l.diag)) {
    if (l.sistema) LiberarParaServicoLocal(l.diag);
    DeleteFileW((l.diag + L"\\audio-mix.log").c_str());
  }

  // 2. Registro COM e de efeito de áudio.
  {
    const std::wstring com = l.classes + L"\\CLSID\\" + CLSID_EFEITO;
    Chave k, servidor;
    CriarChave(l, com, k);
    GravarTexto(k.h, nullptr, L"UniHub Audio Mix");
    CriarChave(l, com + L"\\InprocServer32", servidor);
    GravarTexto(servidor.h, nullptr, destino);
    GravarTexto(servidor.h, L"ThreadingModel", L"Both");

    Chave apo;
    CriarChave(l, l.classes + L"\\AudioEngine\\AudioProcessingObjects\\" + CLSID_EFEITO, apo);
    GravarTexto(apo.h, L"FriendlyName", L"UniHub Audio Mix");
    GravarTexto(apo.h, L"Copyright", L"UniHub (MIT)");
    const struct { const wchar_t* nome; DWORD valor; } numeros[] = {
      { L"MajorVersion", 1 }, { L"MinorVersion", 0 }, { L"Flags", 0xF },
      { L"MinInputConnections", 1 }, { L"MaxInputConnections", 1 }, { L"MinOutputConnections", 1 }, { L"MaxOutputConnections", 1 },
      { L"MaxInstances", 0xFFFFFFFFu }, { L"NumAPOInterfaces", 1 },
    };
    for (const auto& n : numeros) {
      const LONG r = RegSetValueExW(apo.h, n.nome, 0, REG_DWORD, reinterpret_cast<const BYTE*>(&n.valor), sizeof(n.valor));
      if (r != ERROR_SUCCESS) Falhar(L"O Windows não deixou registrar o efeito" + Erro(r) + L".");
    }
    GravarTexto(apo.h, L"APOInterface0", L"{FD7F2B29-24D0-4B5C-B177-592C39F9CA10}");
  }

  // 3 e 4. Administradores só têm "definir valor" na chave de efeitos do microfone:
  //        abre pedindo só isso e a leitura.
  Chave k;
  const LONG r = RegOpenKeyExW(l.raiz, (l.capturas + L"\\" + mic + L"\\FxProperties").c_str(), 0, KEY_SET_VALUE | KEY_QUERY_VALUE, &k.h);
  if (r != ERROR_SUCCESS) Falhar(L"Não foi possível abrir os efeitos do microfone no Windows" + Erro(r) + L".");

  Copia antes;
  antes.existia = LerLista(k.h, EFX, antes.valor);
  GuardarCopia(l.pasta + L"\\backup-efx-" + curto + L".json", antes);
  std::vector<std::wstring> lista = SemEfeito(antes.valor);
  // Microfone que só tem o efeito de ponta no formato antigo (um só, no valor ,7): com a
  // lista nova criada, o Windows passa a seguir a lista. O efeito antigo entra nela
  // primeiro, para continuar rodando antes do nosso. O valor antigo fica como está, e
  // volta a valer quando a lista for removida.
  if (!antes.existia) {
    std::wstring antigo;
    if (LerTexto(k.h, EFX_ANTIGO, antigo) && EhGuid(antigo) && !MesmoTexto(antigo, GUID_NULO) && !MesmoTexto(antigo, CLSID_EFEITO)) lista.push_back(antigo);
  }
  lista.push_back(CLSID_EFEITO);
  GravarLista(k.h, EFX, lista);
  std::vector<std::wstring> gravada;
  if (!LerLista(k.h, EFX, gravada) || !TemEfeito(gravada)) Falhar(L"O Windows não guardou o efeito na lista do microfone.");

  // 5. "Melhorias de áudio" desligadas neste microfone: o Windows não rodaria o efeito.
  //    Liga, guardando como estava para o remover devolver.
  DWORD desligadas = 0;
  if (LerNumero(k.h, MELHORIAS, desligadas) && desligadas != 0) {
    Copia c;
    c.existia = true;
    c.valor.push_back(std::to_wstring(desligadas));
    GuardarCopia(l.pasta + L"\\backup-melhorias-" + curto + L".json", c, true);
    GravarNumero(k.h, MELHORIAS, 0);
  }

  // 6. Versões antigas punham o efeito na lista de fluxo e ligavam o modo comunicação
  //    nela. Com o efeito de ponta isso sobra (e somaria o som duas vezes): desfaz.
  std::vector<std::wstring> fluxo;
  if (LerLista(k.h, SFX, fluxo) && TemEfeito(fluxo)) GravarOuApagar(k.h, SFX, SemEfeito(fluxo));
  const std::wstring copiaModos = l.pasta + L"\\backup-modos-" + curto + L".json";
  Copia modos;
  if (LerCopia(copiaModos, modos)) {
    Restaurar(k.h, MODOS, modos);
    DeleteFileW(copiaModos.c_str());
  }
  return lista;
}

static void Instalar(const Lugar& l, const std::wstring& mic) {
  Conferir(l, mic);
  bool audioParado = false;
  std::vector<std::wstring> lista;
  try {
    lista = InstalarPassos(l, mic, audioParado);
  } catch (...) {
    // Parou no meio com o serviço de áudio desligado: devolve o som antes de avisar.
    if (audioParado) ReiniciarAudio(l);
    throw;
  }
  // 7. Reinicia o áudio para o efeito valer.
  if (!ReiniciarAudio(l)) Falhar(L"O efeito foi instalado, mas não foi possível reiniciar o som do Windows. Reinicie o computador para terminar.");
  Dizer(L"Efeito instalado. Efeitos de ponta do microfone: " + Juntar(lista));
}

// --- Remover -------------------------------------------------------------------------

// Devolve os efeitos de um microfone ao que eram. Lança Falha se algo não der certo.
static void RemoverDoMicrofone(const Lugar& l, const std::wstring& id, HKEY k) {
  const std::wstring curto = (id.size() >= 2 && id.front() == L'{') ? id.substr(1, id.size() - 2) : id;
  const std::wstring copias[] = {
    l.pasta + L"\\backup-" + curto + L".json",           // efeitos de fluxo (versões antigas)
    l.pasta + L"\\backup-efx-" + curto + L".json",       // efeitos de ponta
    l.pasta + L"\\backup-modos-" + curto + L".json",     // modos dos efeitos de fluxo (versões antigas)
    l.pasta + L"\\backup-melhorias-" + curto + L".json", // melhorias de áudio
  };
  const struct { const wchar_t* valor; const wchar_t* nome; const wchar_t* de; } listas[] = {
    { SFX, L"lista de efeitos", L"da lista de efeitos" }, { EFX, L"efeitos de ponta", L"dos efeitos de ponta" },
  };
  for (int i = 0; i < 2; i++) {
    Copia c;
    std::vector<std::wstring> atual;
    if (LerCopia(copias[i], c)) {
      // Se a cópia foi feita com o efeito já na lista, ele não volta: a DLL vai ser apagada.
      c.valor = SemEfeito(c.valor);
      if (c.existia) GravarOuApagar(k, listas[i].valor, c.valor); else ApagarValor(k, listas[i].valor);
      Dizer(L"Microfone " + id + L": " + listas[i].nome + L" como antes (da cópia).");
    } else if (LerLista(k, listas[i].valor, atual) && TemEfeito(atual)) {
      GravarOuApagar(k, listas[i].valor, SemEfeito(atual));
      Dizer(L"Microfone " + id + L": efeito tirado " + listas[i].de + L" (sem cópia).");
    }
  }
  Copia c;
  if (LerCopia(copias[2], c)) {
    Restaurar(k, MODOS, c);
    Dizer(L"Microfone " + id + L": modos dos efeitos como antes (da cópia).");
  }
  // "Melhorias de áudio": se a instalação ligou, volta a ficar como estava.
  if (LerCopia(copias[3], c)) {
    if (c.existia && !c.valor.empty()) GravarNumero(k, MELHORIAS, wcstoul(c.valor[0].c_str(), nullptr, 10));
    Dizer(L"Microfone " + id + L": melhorias de áudio como estavam antes.");
  }
  // Tudo devolvido: as cópias deste microfone não servem mais.
  for (const std::wstring& arquivo : copias) DeleteFileW(arquivo.c_str());
}

static void Remover(const Lugar& l) {
  std::vector<std::wstring> falhas;
  {
    Chave capturas;
    if (RegOpenKeyExW(l.raiz, l.capturas.c_str(), 0, KEY_ENUMERATE_SUB_KEYS, &capturas.h) == ERROR_SUCCESS) {
      std::vector<std::wstring> ids;
      wchar_t nome[256];
      for (DWORD i = 0;; i++) {
        DWORD tam = 256;
        if (RegEnumKeyExW(capturas.h, i, nome, &tam, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
        ids.push_back(nome);
      }
      for (const std::wstring& id : ids) {
        // Administradores só têm "definir valor" nesta chave: abre pedindo só isso e a leitura.
        Chave k;
        const LONG r = RegOpenKeyExW(l.raiz, (l.capturas + L"\\" + id + L"\\FxProperties").c_str(), 0, KEY_SET_VALUE | KEY_QUERY_VALUE, &k.h);
        if (r == ERROR_FILE_NOT_FOUND) continue; // microfone sem efeitos
        try {
          if (r != ERROR_SUCCESS) Falhar(L"o Windows não deixou abrir os efeitos" + Erro(r));
          RemoverDoMicrofone(l, id, k.h);
        } catch (const Falha& f) {
          falhas.push_back(id);
          Dizer(L"Microfone " + id + L": não foi possível restaurar (" + f.texto + L").");
        }
      }
    }
  }

  RegDeleteTreeW(l.raiz, (l.classes + L"\\AudioEngine\\AudioProcessingObjects\\" + CLSID_EFEITO).c_str());
  RegDeleteTreeW(l.raiz, (l.classes + L"\\CLSID\\" + CLSID_EFEITO).c_str());

  // Reinicia o áudio para soltar a DLL, e só depois apaga a pasta.
  const bool audioVoltou = ReiniciarAudio(l);
  if (l.sistema) Sleep(2000);
  // Com falha, as cópias dos microfones que faltaram ficam, para uma nova tentativa.
  bool apagou = false;
  if (falhas.empty()) apagou = ApagarPasta(l.pasta);
  else { DeleteFileW((l.pasta + L"\\" + NOME_DLL).c_str()); DeleteFileW((l.pasta + L"\\versao.txt").c_str()); }
  DeleteFileW((l.diag + L"\\audio-mix.log").c_str());

  if (!falhas.empty()) Falhar(L"O efeito foi removido, mas não deu para restaurar os efeitos de: " + Juntar(falhas) + L".");
  if (!audioVoltou) Falhar(L"O efeito foi removido, mas não foi possível reiniciar o som do Windows. Reinicie o computador para terminar.");
  if (apagou) Dizer(L"Efeito removido.");
  else Dizer(L"Efeito removido. Não deu para apagar " + l.pasta + L" agora (arquivo em uso); apague depois de reiniciar o computador.");
}

// --- Pedido de administrador ---------------------------------------------------------

static void Imprimir(const std::string& texto) {
  const HANDLE h = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD n = 0;
  if (h && h != INVALID_HANDLE_VALUE && !texto.empty()) WriteFile(h, texto.data(), static_cast<DWORD>(texto.size()), &n, nullptr);
}

static bool EhFicha(const std::wstring& s) {
  if (s.size() != 32) return false;
  for (const wchar_t c : s) if (!((c >= L'0' && c <= L'9') || (c >= L'a' && c <= L'f'))) return false;
  return true;
}

// Reabre este programa como administrador (o Windows pede a permissão), espera terminar
// e repassa o texto e o código de saída. O texto volta por um canal com nome sorteado,
// criado aqui; a cópia com administrador se liga a ele sem deixar que este lado aja em
// nome dela.
static int Relancar(const std::wstring& pedido) {
  BYTE sorteio[16];
  if (BCryptGenRandom(nullptr, sorteio, sizeof(sorteio), BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) Falhar(L"Não foi possível preparar o pedido de administrador.");
  std::wstring ficha;
  for (const BYTE b : sorteio) { ficha += L"0123456789abcdef"[b >> 4]; ficha += L"0123456789abcdef"[b & 15]; }
  const HANDLE canal = CreateNamedPipeW((PIPE_PREFIXO + ficha).c_str(), PIPE_ACCESS_INBOUND | FILE_FLAG_FIRST_PIPE_INSTANCE,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 0, 65536, 0, nullptr);
  if (canal == INVALID_HANDLE_VALUE) Falhar(L"Não foi possível preparar o pedido de administrador" + Erro(static_cast<LONG>(GetLastError())) + L".");

  wchar_t eu[MAX_PATH * 4];
  GetModuleFileNameW(nullptr, eu, MAX_PATH * 4);
  const std::wstring parametros = pedido + L" --elevado " + ficha;
  SHELLEXECUTEINFOW info = {};
  info.cbSize = sizeof(info);
  info.fMask = SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI;
#ifdef INSTALADOR_TESTE
  info.lpVerb = L"open"; // o teste confere o caminho sem o pedido de administrador
#else
  info.lpVerb = L"runas";
#endif
  info.lpFile = eu;
  info.lpParameters = parametros.c_str();
  info.nShow = SW_HIDE;
  if (!ShellExecuteExW(&info) || !info.hProcess) {
    const DWORD erro = GetLastError();
    CloseHandle(canal);
    if (erro == ERROR_CANCELLED) return ERROR_CANCELLED; // 1223: a pessoa recusou
    Falhar(L"Não foi possível pedir a permissão de administrador" + Erro(static_cast<LONG>(erro)) + L".");
  }
  WaitForSingleObject(info.hProcess, INFINITE);
  DWORD codigo = 1;
  GetExitCodeProcess(info.hProcess, &codigo);
  CloseHandle(info.hProcess);
  // A outra cópia escreveu tudo de uma vez e já saiu; sem ela, a leitura falha na hora.
  std::string texto;
  char buf[4096];
  DWORD n = 0;
  while (texto.size() < 65536 && ReadFile(canal, buf, sizeof(buf), &n, nullptr) && n) texto.append(buf, n);
  CloseHandle(canal);
  Imprimir(texto);
  return static_cast<int>(codigo);
}

// Entrega o texto: pelo canal de quem pediu administrador, ou direto na saída padrão.
static void Entregar(const std::wstring& ficha) {
  std::string texto = Utf8(g_saida);
  if (texto.size() > 8000) texto.resize(8000);
  if (ficha.empty()) { Imprimir(texto); return; }
  // SECURITY_ANONYMOUS: quem criou o canal não consegue agir com a permissão deste processo.
  const HANDLE canal = CreateFileW((PIPE_PREFIXO + ficha).c_str(), GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, SECURITY_SQOS_PRESENT | SECURITY_ANONYMOUS, nullptr);
  if (canal == INVALID_HANDLE_VALUE) return;
  DWORD n = 0;
  if (GetFileType(canal) == FILE_TYPE_PIPE) WriteFile(canal, texto.data(), static_cast<DWORD>(texto.size()), &n, nullptr);
  CloseHandle(canal);
}

static std::wstring PastaConhecida(REFKNOWNFOLDERID id) {
  PWSTR p = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &p)) && p) out = p;
  CoTaskMemFree(p);
  return out;
}

static Lugar LugarDoPrograma() {
  Lugar l;
  wchar_t eu[MAX_PATH * 4];
  GetModuleFileNameW(nullptr, eu, MAX_PATH * 4);
  l.origem = eu;
  l.origem.resize(l.origem.find_last_of(L'\\'));
#ifdef INSTALADOR_TESTE
  wchar_t base[MAX_PATH] = L"";
  if (!GetEnvironmentVariableW(L"UNUSHUB_TESTE_PASTA", base, MAX_PATH)) Falhar(L"Teste: defina UNUSHUB_TESTE_PASTA.");
  l.raiz = HKEY_CURRENT_USER;
  l.capturas = L"Software\\UnusHubTeste\\Capture";
  l.classes = L"Software\\UnusHubTeste\\Classes";
  l.pasta = std::wstring(base) + L"\\instalado";
  l.diag = std::wstring(base) + L"\\diag";
  l.sistema = false;
#else
  // Pastas do Windows perguntadas a ele (não C:\ fixo: o Windows pode estar em outra unidade).
  const std::wstring programas = PastaConhecida(FOLDERID_ProgramFiles), dados = PastaConhecida(FOLDERID_ProgramData);
  if (programas.empty() || dados.empty()) Falhar(L"Não foi possível achar as pastas do Windows.");
  l.capturas = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture";
  l.classes = L"SOFTWARE\\Classes";
  l.pasta = programas + L"\\UniHub\\audio-mix";
  l.diag = dados + L"\\UniHub";
#endif
  return l;
}

int wmain(int argc, wchar_t** argv) {
  std::wstring mic, ficha;
  bool instalar = false, remover = false, usoErrado = false;
  for (int i = 1; i < argc; i++) {
    const std::wstring a = argv[i];
    if (a == L"--instalar" && i + 1 < argc) { instalar = true; mic = argv[++i]; }
    else if (a == L"--remover") remover = true;
    else if (a == L"--elevado" && i + 1 < argc) ficha = argv[++i];
    else usoErrado = true;
  }
  if (usoErrado || instalar == remover || (!ficha.empty() && !EhFicha(ficha))) {
    Imprimir("Uso: efeito-unushub.exe --instalar {id do microfone} | --remover\n");
    return 2;
  }

  int codigo = 0;
  try {
    const Lugar l = LugarDoPrograma();
#ifdef INSTALADOR_TESTE
    wchar_t v[4];
    const bool administrador = !ficha.empty() || !GetEnvironmentVariableW(L"UNUSHUB_TESTE_RELANCAR", v, 4);
#else
    const bool administrador = Administrador();
#endif
    if (!administrador) {
      if (!ficha.empty()) Falhar(L"O Windows não deu a permissão de administrador.");
      // Antes de incomodar com o pedido de administrador, o que já dá para recusar.
      if (instalar) Conferir(l, mic);
      return Relancar(instalar ? L"--instalar " + mic : L"--remover");
    }
    if (instalar) Instalar(l, mic); else Remover(l);
  } catch (const Falha& f) {
    Dizer(f.texto);
    codigo = 1;
  }
  Entregar(ficha);
  return codigo;
}
