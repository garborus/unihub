// Efeito de áudio (APO) do UniHub: soma ao microfone o som que chega pelo canal.
//
// O Windows carrega esta DLL no processo de áudio (audiodg.exe) quando um app
// abre o microfone em que ela está registrada. A cada bloco de áudio ele chama
// APOProcess; aqui a voz passa igual e o som do canal é somado por cima.
// Escrito a partir da documentação pública de APOs da Microsoft.

#include <windows.h>
#include <sddl.h>
#include <stdio.h>
#include <stdarg.h>
#include <new>
#include <audioenginebaseapo.h>
#include <baseaudioprocessingobject.h>
#include "../comum/canal.h"

// {6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}
static const CLSID CLSID_MixApo = { 0x6b1f3c2a, 0x8e4d, 0x4f7b, { 0x9a, 0x15, 0x3c, 0x2d, 0x7e, 0x9f, 0x0a, 0x41 } };

static HMODULE g_modulo = nullptr;

// Diagnóstico: uma linha por evento em %ProgramData%\UniHub\audio-mix.log (a pasta é
// criada pelo instalador do efeito com escrita liberada para o serviço de áudio).
// Nunca chamado de dentro do APOProcess, que é tempo real.
//
// Desligado no uso normal. Liga só se existir o arquivo %ProgramData%\UniHub\log-ligado
// (conferido uma vez, quando a DLL carrega), e o registro recomeça ao passar de 1 MB.

// Caminho de um arquivo na pasta de diagnóstico. %ProgramData% e não C:\ fixo: o
// Windows pode estar em outra unidade.
static const wchar_t* ArquivoDiag(const wchar_t* nome, wchar_t* buf, size_t n) {
  wchar_t base[MAX_PATH];
  const DWORD lido = GetEnvironmentVariableW(L"ProgramData", base, MAX_PATH);
  swprintf_s(buf, n, L"%s\\UniHub\\%s", (lido > 0 && lido < MAX_PATH) ? base : L"C:\\ProgramData", nome);
  return buf;
}

static bool LogLigado() {
  wchar_t caminho[MAX_PATH + 40];
  static const bool ligado = GetFileAttributesW(ArquivoDiag(L"log-ligado", caminho, MAX_PATH + 40)) != INVALID_FILE_ATTRIBUTES;
  return ligado;
}

static void Log(const wchar_t* formato, ...) {
  if (!LogLigado()) return;
  wchar_t texto[512];
  SYSTEMTIME t;
  GetLocalTime(&t);
  int n = swprintf_s(texto, L"%02d:%02d:%02d.%03d [pid %lu] ", t.wHour, t.wMinute, t.wSecond, t.wMilliseconds, GetCurrentProcessId());
  va_list va;
  va_start(va, formato);
  n += vswprintf_s(texto + n, 512 - n - 2, formato, va);
  va_end(va);
  texto[n++] = L'\r';
  texto[n++] = L'\n';
  char utf8[1024];
  int bytes = WideCharToMultiByte(CP_UTF8, 0, texto, n, utf8, sizeof(utf8), nullptr, nullptr);
  wchar_t arquivo[MAX_PATH + 40];
  ArquivoDiag(L"audio-mix.log", arquivo, MAX_PATH + 40);
  HANDLE f = CreateFileW(arquivo, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                         nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) return;
  LARGE_INTEGER tamanho;
  if (GetFileSizeEx(f, &tamanho) && tamanho.QuadPart > 1024 * 1024) {
    // Passou de 1 MB: recomeça o arquivo (FILE_APPEND_DATA não deixa truncar).
    CloseHandle(f);
    f = CreateFileW(arquivo, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE,
                    nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (f == INVALID_HANDLE_VALUE) return;
  }
  DWORD escritos;
  WriteFile(f, utf8, bytes, &escritos, nullptr);
  CloseHandle(f);
}

static const wchar_t* Formato(IAudioMediaType* tipo, wchar_t* buf, size_t n) {
  UNCOMPRESSEDAUDIOFORMAT f = {};
  if (!tipo || FAILED(tipo->GetUncompressedAudioFormat(&f))) { swprintf_s(buf, n, L"(nenhum)"); return buf; }
  swprintf_s(buf, n, L"%s %lu canais %lu bits %.0f Hz",
             f.guidFormatType.Data1 == 3 ? L"float" : (f.guidFormatType.Data1 == 1 ? L"pcm" : L"outro"),
             f.dwSamplesPerFrame, f.dwValidBitsPerSample, f.fFramesPerSecond);
  return buf;
}
static volatile LONG g_objetos = 0;
static volatile LONG g_travas = 0;

static const CRegAPOProperties<1> g_props(
  CLSID_MixApo, L"UniHub Audio Mix", L"UniHub (MIT)",
  1, 0, __uuidof(IAudioProcessingObject),
  static_cast<APO_FLAG>(APO_FLAG_SAMPLESPERFRAME_MUST_MATCH | APO_FLAG_FRAMESPERSECOND_MUST_MATCH |
                        APO_FLAG_BITSPERSAMPLE_MUST_MATCH | APO_FLAG_INPLACE));

// O motor de áudio cria o efeito agregado: passa um objeto "externo" e pede o
// IUnknown interno. Por isso há dois IUnknown: o interno (Interno, que conta as
// referências e responde por todas as interfaces) e o das interfaces do efeito,
// que repassa tudo para o externo (ou para o interno, sem agregação).
class MixApo final : public CBaseAudioProcessingObject, public IAudioSystemEffects {
public:
  explicit MixApo(IUnknown* externo)
    : CBaseAudioProcessingObject(static_cast<const APO_REG_PROPERTIES*>(g_props)), m_interno(this),
      m_externo(externo ? externo : &m_interno) {
    InterlockedIncrement(&g_objetos);
  }
  ~MixApo() { FecharCanal(); InterlockedDecrement(&g_objetos); }

  class Interno final : public IUnknown {
  public:
    explicit Interno(MixApo* dono) : m_dono(dono) {}
    STDMETHODIMP QueryInterface(REFIID iid, void** ppv) override { return m_dono->QueryInterno(iid, ppv); }
    STDMETHODIMP_(ULONG) AddRef() override { return InterlockedIncrement(&m_dono->m_refs); }
    STDMETHODIMP_(ULONG) Release() override {
      ULONG n = InterlockedDecrement(&m_dono->m_refs);
      if (n == 0) delete m_dono;
      return n;
    }
  private:
    MixApo* m_dono;
  };
  Interno* Desagregado() { return &m_interno; }

  // IUnknown das interfaces do efeito: sempre pelo externo.
  STDMETHODIMP QueryInterface(REFIID iid, void** ppv) override { return m_externo->QueryInterface(iid, ppv); }
  STDMETHODIMP_(ULONG) AddRef() override { return m_externo->AddRef(); }
  STDMETHODIMP_(ULONG) Release() override { return m_externo->Release(); }

  HRESULT QueryInterno(REFIID iid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (iid == __uuidof(IUnknown)) {
      *ppv = &m_interno;
      m_interno.AddRef();
      return S_OK;
    }
    if (iid == __uuidof(IAudioProcessingObject))
      *ppv = static_cast<IAudioProcessingObject*>(this);
    else if (iid == __uuidof(IAudioProcessingObjectRT))
      *ppv = static_cast<IAudioProcessingObjectRT*>(this);
    else if (iid == __uuidof(IAudioProcessingObjectConfiguration))
      *ppv = static_cast<IAudioProcessingObjectConfiguration*>(this);
    else if (iid == __uuidof(IAudioSystemEffects))
      *ppv = static_cast<IAudioSystemEffects*>(this);
    else {
      wchar_t g[40];
      StringFromGUID2(iid, g, 40);
      Log(L"QueryInterface sem suporte: %s", g);
      return E_NOINTERFACE;
    }
    static_cast<IUnknown*>(*ppv)->AddRef(); // pelo externo, como manda a agregação
    return S_OK;
  }

  // Só float de 32 bits: é o formato que o Windows usa entre os efeitos.
  STDMETHODIMP IsInputFormatSupported(IAudioMediaType* saida, IAudioMediaType* pedido, IAudioMediaType** suportado) override {
    HRESULT hr = CBaseAudioProcessingObject::IsInputFormatSupported(saida, pedido, suportado);
    wchar_t a[96], b[96];
    Log(L"IsInputFormatSupported pedido=[%s] saida=[%s] -> 0x%08lx", Formato(pedido, a, 96), Formato(saida, b, 96), hr);
    return hr;
  }

  STDMETHODIMP IsOutputFormatSupported(IAudioMediaType* entrada, IAudioMediaType* pedido, IAudioMediaType** suportado) override {
    HRESULT hr = CBaseAudioProcessingObject::IsOutputFormatSupported(entrada, pedido, suportado);
    wchar_t a[96], b[96];
    Log(L"IsOutputFormatSupported pedido=[%s] entrada=[%s] -> 0x%08lx", Formato(pedido, a, 96), Formato(entrada, b, 96), hr);
    return hr;
  }

  STDMETHODIMP Initialize(UINT32 tamanho, BYTE* dados) override {
    HRESULT hr = CBaseAudioProcessingObject::Initialize(tamanho, dados);
    Log(L"Initialize(%u bytes) -> 0x%08lx", tamanho, hr);
    return hr;
  }

  STDMETHODIMP LockForProcess(UINT32 nIn, APO_CONNECTION_DESCRIPTOR** in, UINT32 nOut, APO_CONNECTION_DESCRIPTOR** out) override {
    HRESULT hr = CBaseAudioProcessingObject::LockForProcess(nIn, in, nOut, out);
    wchar_t a[96];
    Log(L"LockForProcess entradas=%u saidas=%u formato=[%s] -> 0x%08lx", nIn, nOut, nIn ? Formato(in[0]->pFormat, a, 96) : L"-", hr);
    if (FAILED(hr)) return hr;
    UNCOMPRESSEDAUDIOFORMAT formato = {};
    if (nIn > 0 && in[0]->pFormat && SUCCEEDED(in[0]->pFormat->GetUncompressedAudioFormat(&formato))) {
      m_canais = formato.dwSamplesPerFrame;
      m_taxa = formato.fFramesPerSecond;
    }
    AbrirCanal();
    return S_OK;
  }

  STDMETHODIMP UnlockForProcess() override {
    FecharCanal();
    return CBaseAudioProcessingObject::UnlockForProcess();
  }

  // Tempo real: nada de travas, memória nova nem chamadas que esperam.
  STDMETHODIMP_(void) APOProcess(UINT32 nIn, APO_CONNECTION_PROPERTY** in, UINT32 nOut, APO_CONNECTION_PROPERTY** out) override {
    if (nIn < 1 || nOut < 1) return;
    const APO_CONNECTION_PROPERTY* ent = in[0];
    APO_CONNECTION_PROPERTY* sai = out[0];
    const UINT32 quadros = ent->u32ValidFrameCount;
    const UINT32 canais = m_canais;
    const float* origem = reinterpret_cast<const float*>(ent->pBuffer);
    float* destino = reinterpret_cast<float*>(sai->pBuffer);

    // Voz: passa igual (ou silêncio, se o bloco veio marcado como silencioso).
    const bool silencio = ent->u32BufferFlags == BUFFER_SILENT;
    if (silencio) ZeroMemory(destino, quadros * canais * sizeof(float));
    else if (destino != origem) CopyMemory(destino, origem, quadros * canais * sizeof(float));

    bool somou = false;
    if (m_canal && m_canal->magico == CANAL_MAGICO) {
      // O tamanho do anel é o fixo (CANAL_QUADROS), nunca o que está escrito no canal:
      // o canal é memória que outros programas alcançam, e um valor errado ali (zero,
      // por exemplo) derrubaria o serviço de áudio do Windows.
      const int64_t anel = CANAL_QUADROS;
      const int64_t escritos = m_canal->escritos;
      // Posição fora do possível (canal recriado ou corrompido): recomeça do agora.
      if (m_lidos > escritos || m_lidos < 0) m_lidos = escritos;
      // Atrasou mais que o anel: pula para o que ainda está lá.
      if (escritos - m_lidos > anel) m_lidos = escritos - anel;
      // Converte 48000 Hz para a taxa do microfone, interpolando entre duas amostras
      // (a 48000 Hz a fração fica em zero e a amostra sai igual).
      const double passo = static_cast<double>(CANAL_TAXA) / (m_taxa > 0 ? m_taxa : CANAL_TAXA);
      for (UINT32 q = 0; q < quadros && m_lidos < escritos; q++) {
        const float atual = m_canal->dados[m_lidos % anel];
        const float proxima = (m_lidos + 1 < escritos) ? m_canal->dados[(m_lidos + 1) % anel] : atual;
        const float amostra = atual + (proxima - atual) * static_cast<float>(m_fracao);
        for (UINT32 c = 0; c < canais; c++) {
          float v = destino[q * canais + c] + amostra;
          destino[q * canais + c] = v > 1.f ? 1.f : (v < -1.f ? -1.f : v);
        }
        m_fracao += passo;
        const int64_t avancar = static_cast<int64_t>(m_fracao);
        m_fracao -= static_cast<double>(avancar);
        m_lidos += avancar;
        somou = true;
      }
    }

    sai->u32ValidFrameCount = quadros;
    sai->u32BufferFlags = (silencio && !somou) ? BUFFER_SILENT : BUFFER_VALID;
  }

private:
  void AbrirCanal() {
    if (m_canal) return;
    // Qualquer usuário conectado pode escrever; integridade baixa para o app comum alcançar.
    PSECURITY_DESCRIPTOR sd = nullptr;
    SECURITY_ATTRIBUTES sa = { sizeof(sa), nullptr, FALSE };
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(
          L"D:(A;;GA;;;SY)(A;;GA;;;LS)(A;;GA;;;BA)(A;;GRGW;;;IU)S:(ML;;NW;;;LW)", SDDL_REVISION_1, &sd, nullptr))
      sa.lpSecurityDescriptor = sd;
    m_mapa = CreateFileMappingW(INVALID_HANDLE_VALUE, sa.lpSecurityDescriptor ? &sa : nullptr,
                                PAGE_READWRITE, 0, sizeof(Canal), CANAL_NOME);
    const DWORD erro = GetLastError();
    const bool novo = m_mapa && erro != ERROR_ALREADY_EXISTS;
    if (sd) LocalFree(sd);
    if (!m_mapa) { Log(L"CreateFileMapping falhou: erro %lu (descritor de seguranca %s)", erro, sd ? L"ok" : L"falhou"); return; }
    m_canal = static_cast<Canal*>(MapViewOfFile(m_mapa, FILE_MAP_ALL_ACCESS, 0, 0, sizeof(Canal)));
    if (!m_canal) { Log(L"MapViewOfFile falhou: erro %lu", GetLastError()); CloseHandle(m_mapa); m_mapa = nullptr; return; }
    Log(L"Canal aberto (%s)", novo ? L"criado agora" : L"ja existia");
    if (novo) {
      m_canal->versao = CANAL_VERSAO;
      m_canal->taxa = CANAL_TAXA;
      m_canal->quadros = CANAL_QUADROS;
      m_canal->escritos = 0;
      MemoryBarrier();
      m_canal->magico = CANAL_MAGICO;
    }
    InterlockedIncrement(reinterpret_cast<volatile LONG*>(&m_canal->leitores));
    m_lidos = m_canal->escritos; // começa do agora, não toca o que já passou
    m_fracao = 0;
  }

  void FecharCanal() {
    if (m_canal) {
      InterlockedDecrement(reinterpret_cast<volatile LONG*>(&m_canal->leitores));
      UnmapViewOfFile(m_canal);
      m_canal = nullptr;
    }
    if (m_mapa) { CloseHandle(m_mapa); m_mapa = nullptr; }
  }

  volatile LONG m_refs = 1;
  Interno m_interno;
  IUnknown* m_externo;
  UINT32 m_canais = 1;  // formato do microfone, lido em LockForProcess
  float m_taxa = CANAL_TAXA;
  HANDLE m_mapa = nullptr;
  Canal* m_canal = nullptr;
  int64_t m_lidos = 0;
  double m_fracao = 0;
};

class Fabrica final : public IClassFactory {
public:
  STDMETHODIMP QueryInterface(REFIID iid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IClassFactory)) { *ppv = this; return S_OK; }
    *ppv = nullptr;
    wchar_t g[40];
    StringFromGUID2(iid, g, 40);
    Log(L"Fabrica: QueryInterface sem suporte: %s", g);
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return 2; }
  STDMETHODIMP_(ULONG) Release() override { return 1; }
  STDMETHODIMP CreateInstance(IUnknown* externo, REFIID iid, void** ppv) override {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    // Agregado, só se pode pedir o IUnknown interno.
    if (externo && iid != __uuidof(IUnknown)) { Log(L"CreateInstance agregado pediu outra interface"); return CLASS_E_NOAGGREGATION; }
    MixApo* apo = new (std::nothrow) MixApo(externo);
    if (!apo) return E_OUTOFMEMORY;
    HRESULT hr = apo->Desagregado()->QueryInterface(iid, ppv);
    apo->Desagregado()->Release();
    Log(L"CreateInstance (%s) -> 0x%08lx", externo ? L"agregado" : L"sozinho", hr);
    return hr;
  }
  STDMETHODIMP LockServer(BOOL travar) override {
    if (travar) InterlockedIncrement(&g_travas); else InterlockedDecrement(&g_travas);
    return S_OK;
  }
};

static Fabrica g_fabrica;

extern "C" BOOL WINAPI DllMain(HINSTANCE modulo, DWORD motivo, LPVOID) {
  if (motivo == DLL_PROCESS_ATTACH) {
    g_modulo = modulo;
    DisableThreadLibraryCalls(modulo);
    wchar_t exe[MAX_PATH] = L"";
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    Log(L"DLL carregada em %s", exe);
  }
  return TRUE;
}

static const wchar_t* Guid(REFGUID g, wchar_t* buf) {
  StringFromGUID2(g, buf, 40);
  return buf;
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID iid, void** ppv) {
  wchar_t a[40], b[40];
  HRESULT hr = clsid != CLSID_MixApo ? CLASS_E_CLASSNOTAVAILABLE : g_fabrica.QueryInterface(iid, ppv);
  Log(L"DllGetClassObject clsid=%s iid=%s -> 0x%08lx", Guid(clsid, a), Guid(iid, b), hr);
  return hr;
}

STDAPI DllCanUnloadNow() {
  return (g_objetos == 0 && g_travas == 0) ? S_OK : S_FALSE;
}
