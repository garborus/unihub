// Aparelhos de som do Windows (saídas e microfones): lista os ativos, troca o
// padrão, e lê ou muda volume e mudo.
//
// A web não troca o aparelho padrão nem o volume do Windows; a tela de Som do
// Windows faz isso por interfaces COM do próprio Windows, que este programa usa do
// mesmo jeito, só quando a pessoa escolhe algo no UniHub.
//
// Uso: saidas.exe --listar                  -> {"saidas":[…],"microfones":[…]}
//        cada item: {"id","name","default","comm","volume":0-100,"mute":bool}
//        default = padrão do Windows; comm = padrão das chamadas (Discord, WhatsApp…)
//      saidas.exe --microfones              -> {"arm64":bool,"microfones":[…]}
//        microfones ativos e o estado do efeito do UnusHub em cada um (só leitura):
//        {"id":"{guid}","name","device","bus","installed","calls","sysfxOff"}
//        installed = o efeito está numa lista de efeitos do microfone; calls = na
//        lista de ponta (vale nas chamadas); sysfxOff = as "melhorias de áudio" do
//        Windows estão desligadas nele (aí nenhum efeito roda); bus = quem criou o
//        aparelho (USB, BTHHFENUM…); arm64 = Windows em ARM64, onde a DLL x64 não carrega.
//      saidas.exe --padrao <id> <todos|normal|chamadas>
//      saidas.exe --volume <id> <0-100>
//      saidas.exe --mudo <id> <0|1>
// Saída em UTF-8 ({"ok":true} ou {"ok":false,"erro":"…"} nos comandos). Código 0 ok, 1 erro.

#include <windows.h>
#include <mmdeviceapi.h>
#include <endpointvolume.h>
#include <functiondiscoverykeys_devpkey.h>
#include <stdio.h>
#include <stdlib.h>
#include <string>
#include <vector>
#include "../comum/canal.h"

// Interface sem documentação oficial, estável desde o Windows 7 (é a que a tela de
// Som do Windows usa). Só SetDefaultEndpoint é chamada; as outras ficam para manter
// a ordem dos métodos.
struct DeviceShareMode;
MIDL_INTERFACE("f8679f50-850a-41cf-9c72-430f290290c8")
IPolicyConfig : public IUnknown {
  virtual HRESULT STDMETHODCALLTYPE GetMixFormat(PCWSTR, WAVEFORMATEX**) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetDeviceFormat(PCWSTR, INT, WAVEFORMATEX**) = 0;
  virtual HRESULT STDMETHODCALLTYPE ResetDeviceFormat(PCWSTR) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDeviceFormat(PCWSTR, WAVEFORMATEX*, WAVEFORMATEX*) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetProcessingPeriod(PCWSTR, INT, PINT64, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetProcessingPeriod(PCWSTR, PINT64) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetShareMode(PCWSTR, DeviceShareMode*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetShareMode(PCWSTR, DeviceShareMode*) = 0;
  virtual HRESULT STDMETHODCALLTYPE GetPropertyValue(PCWSTR, const PROPERTYKEY&, PROPVARIANT*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetPropertyValue(PCWSTR, const PROPERTYKEY&, PROPVARIANT*) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(PCWSTR, ERole) = 0;
  virtual HRESULT STDMETHODCALLTYPE SetEndpointVisibility(PCWSTR, INT) = 0;
};
static const CLSID CLSID_PolicyConfigClient = { 0x870af99c, 0x171d, 0x4f9e, { 0xaf, 0x0d, 0xe6, 0x3d, 0xf4, 0x0c, 0x2b, 0xc9 } };

static std::string Utf8(const wchar_t* w) {
  if (!w) return "";
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n - 1 : 0, '\0');
  if (n > 1) WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr); // n inclui o \0, que cabe no buffer da string
  return s;
}

// Texto seguro dentro de aspas JSON.
static std::string Json(const std::string& s) {
  std::string out;
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); out += b; }
    else out += static_cast<char>(c);
  }
  return out;
}

static std::wstring DefaultId(IMMDeviceEnumerator* en, EDataFlow fluxo, ERole papel) {
  std::wstring out;
  IMMDevice* d = nullptr;
  if (SUCCEEDED(en->GetDefaultAudioEndpoint(fluxo, papel, &d))) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(d->GetId(&id))) { out = id; CoTaskMemFree(id); }
    d->Release();
  }
  return out;
}

// Lista de um tipo (saídas ou microfones) em JSON.
static std::string Lista(IMMDeviceEnumerator* en, EDataFlow fluxo) {
  const std::wstring padrao = DefaultId(en, fluxo, eConsole);
  const std::wstring chamadas = DefaultId(en, fluxo, eCommunications);
  std::string out = "[";
  IMMDeviceCollection* lista = nullptr;
  if (FAILED(en->EnumAudioEndpoints(fluxo, DEVICE_STATE_ACTIVE, &lista))) return "[]";
  UINT total = 0;
  lista->GetCount(&total);
  for (UINT i = 0; i < total; i++) {
    IMMDevice* d = nullptr;
    if (FAILED(lista->Item(i, &d))) continue;
    std::string nome;
    IPropertyStore* props = nullptr;
    if (SUCCEEDED(d->OpenPropertyStore(STGM_READ, &props))) {
      PROPVARIANT v;
      PropVariantInit(&v);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &v)) && v.vt == VT_LPWSTR) nome = Utf8(v.pwszVal);
      PropVariantClear(&v);
      props->Release();
    }
    float volume = -1.0f;
    BOOL mudo = FALSE;
    IAudioEndpointVolume* vol = nullptr;
    if (SUCCEEDED(d->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&vol)))) {
      vol->GetMasterVolumeLevelScalar(&volume);
      vol->GetMute(&mudo);
      vol->Release();
    }
    LPWSTR id = nullptr;
    if (SUCCEEDED(d->GetId(&id))) {
      char num[16];
      sprintf_s(num, "%d", volume < 0 ? -1 : static_cast<int>(volume * 100.0f + 0.5f));
      if (out.size() > 1) out += ",";
      out += "{\"id\":\"" + Json(Utf8(id)) + "\",\"name\":\"" + Json(nome) + "\",\"default\":" + (padrao == id ? "true" : "false")
        + ",\"comm\":" + (chamadas == id ? "true" : "false") + ",\"volume\":" + num + ",\"mute\":" + (mudo ? "true" : "false") + "}";
      CoTaskMemFree(id);
    }
    d->Release();
  }
  lista->Release();
  return out + "]";
}

// --- Microfones e o efeito do UnusHub (só leitura) ------------------------------------

// Propriedades do aparelho, como o Windows guarda (MMDevices\Audio\Capture\{id}\Properties).
static const PROPERTYKEY PK_NOME = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 2 };
static const PROPERTYKEY PK_APARELHO = { { 0xb3f8fa53, 0x0004, 0x438e, { 0x90, 0x03, 0x51, 0xa4, 0x6e, 0x13, 0x9b, 0xfc } }, 6 };
static const PROPERTYKEY PK_BARRAMENTO = { { 0xa45c254e, 0xdf1c, 0x4efd, { 0x80, 0x20, 0x67, 0xd1, 0x46, 0xa8, 0x50, 0xe0 } }, 24 };

static std::string Texto(IPropertyStore* props, const PROPERTYKEY& chave) {
  std::string out;
  PROPVARIANT v;
  PropVariantInit(&v);
  if (props && SUCCEEDED(props->GetValue(chave, &v)) && v.vt == VT_LPWSTR) out = Utf8(v.pwszVal);
  PropVariantClear(&v);
  return out;
}

// Uma lista de efeitos do registro (texto ou vários textos) contém o efeito?
static bool ListaTemEfeito(HKEY fx, const wchar_t* valor) {
  DWORD bytes = 0;
  if (RegGetValueW(fx, nullptr, valor, RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ, nullptr, nullptr, &bytes) != ERROR_SUCCESS || bytes < sizeof(wchar_t)) return false;
  std::vector<wchar_t> buf(bytes / sizeof(wchar_t) + 2, L'\0');
  if (RegGetValueW(fx, nullptr, valor, RRF_RT_REG_SZ | RRF_RT_REG_MULTI_SZ, nullptr, buf.data(), &bytes) != ERROR_SUCCESS) return false;
  // Os itens vêm separados por \0: troca por espaço para procurar no texto inteiro.
  const size_t n = bytes / sizeof(wchar_t);
  for (size_t i = 0; i < n; i++) if (buf[i] == L'\0') buf[i] = L' ';
  buf[n] = L'\0';
  _wcsupr_s(buf.data(), buf.size());
  return wcsstr(buf.data(), EFEITO_CLSID_TEXTO) != nullptr; // o CLSID já está em maiúsculas
}

// Windows em ARM64? (o app x64 roda emulado, mas o serviço de áudio não carrega DLL x64)
static bool Arm64() {
  typedef BOOL(WINAPI* Fn)(HANDLE, USHORT*, USHORT*);
  const Fn fn = reinterpret_cast<Fn>(GetProcAddress(GetModuleHandleW(L"kernel32.dll"), "IsWow64Process2"));
  USHORT processo = 0, nativo = 0;
  return fn && fn(GetCurrentProcess(), &processo, &nativo) && nativo == 0xAA64; // IMAGE_FILE_MACHINE_ARM64
}

static int Microfones(IMMDeviceEnumerator* en) {
  std::string out = std::string("{\"arm64\":") + (Arm64() ? "true" : "false") + ",\"microfones\":[";
  IMMDeviceCollection* lista = nullptr;
  bool primeiro = true;
  if (SUCCEEDED(en->EnumAudioEndpoints(eCapture, DEVICE_STATE_ACTIVE, &lista))) {
    UINT total = 0;
    lista->GetCount(&total);
    for (UINT i = 0; i < total; i++) {
      IMMDevice* d = nullptr;
      if (FAILED(lista->Item(i, &d))) continue;
      LPWSTR id = nullptr;
      if (SUCCEEDED(d->GetId(&id))) {
        // "{0.0.1.00000000}.{guid}": a parte depois do ponto é o nome da chave no registro.
        const wchar_t* guid = wcsstr(id, L"}.");
        guid = guid ? guid + 2 : id;
        IPropertyStore* props = nullptr;
        d->OpenPropertyStore(STGM_READ, &props);
        bool instalado = false, chamadas = false, semMelhorias = false;
        const std::wstring chave = std::wstring(L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio\\Capture\\") + guid + L"\\FxProperties";
        HKEY fx = nullptr;
        if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, chave.c_str(), 0, KEY_QUERY_VALUE, &fx) == ERROR_SUCCESS) {
          chamadas = ListaTemEfeito(fx, L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},15"); // efeitos de ponta
          instalado = chamadas || ListaTemEfeito(fx, L"{d04e05a6-594b-4fb6-a80d-01af5eed7d1d},13"); // de fluxo (versões antigas)
          DWORD desligado = 0, tam = sizeof(desligado);
          if (RegGetValueW(fx, nullptr, L"{1da5d803-d492-4edd-8c23-e0c0ffee7f0e},5", RRF_RT_REG_DWORD, nullptr, &desligado, &tam) == ERROR_SUCCESS)
            semMelhorias = desligado != 0;
          RegCloseKey(fx);
        }
        if (!primeiro) out += ",";
        primeiro = false;
        out += "{\"id\":\"" + Json(Utf8(guid)) + "\",\"name\":\"" + Json(Texto(props, PK_NOME)) + "\",\"device\":\"" + Json(Texto(props, PK_APARELHO))
          + "\",\"bus\":\"" + Json(Texto(props, PK_BARRAMENTO)) + "\",\"installed\":" + (instalado ? "true" : "false")
          + ",\"calls\":" + (chamadas ? "true" : "false") + ",\"sysfxOff\":" + (semMelhorias ? "true" : "false") + "}";
        if (props) props->Release();
        CoTaskMemFree(id);
      }
      d->Release();
    }
    lista->Release();
  }
  printf("%s]}\n", out.c_str());
  return 0;
}

// Aparelho ativo pelo id (saída ou microfone), ou nullptr.
static IMMDevice* Ativo(IMMDeviceEnumerator* en, const wchar_t* id) {
  IMMDevice* d = nullptr;
  DWORD estado = 0;
  if (FAILED(en->GetDevice(id, &d))) return nullptr;
  if (FAILED(d->GetState(&estado)) || estado != DEVICE_STATE_ACTIVE) { d->Release(); return nullptr; }
  return d;
}

static int Ok() { printf("{\"ok\":true}\n"); return 0; }
static int Erro(const char* e) { printf("{\"ok\":false,\"erro\":\"%s\"}\n", e); return 1; }

static int Padrao(IMMDeviceEnumerator* en, const wchar_t* id, const wchar_t* quais) {
  IMMDevice* d = Ativo(en, id);
  if (!d) return Erro("aparelho");
  d->Release();
  IPolicyConfig* pc = nullptr;
  if (FAILED(CoCreateInstance(CLSID_PolicyConfigClient, nullptr, CLSCTX_ALL, __uuidof(IPolicyConfig), reinterpret_cast<void**>(&pc)))) return Erro("windows");
  const bool normal = !wcscmp(quais, L"todos") || !wcscmp(quais, L"normal");
  const bool chamadas = !wcscmp(quais, L"todos") || !wcscmp(quais, L"chamadas");
  HRESULT hr = S_OK;
  // "Normal" é o que a tela de Som do Windows troca (console e multimídia).
  if (normal) hr = pc->SetDefaultEndpoint(id, eConsole);
  if (SUCCEEDED(hr) && normal) hr = pc->SetDefaultEndpoint(id, eMultimedia);
  if (SUCCEEDED(hr) && chamadas) hr = pc->SetDefaultEndpoint(id, eCommunications);
  pc->Release();
  if (!normal && !chamadas) return Erro("uso");
  return FAILED(hr) ? Erro("falhou") : Ok();
}

static int Volume(IMMDeviceEnumerator* en, const wchar_t* id, const wchar_t* valor, bool mudo) {
  IMMDevice* d = Ativo(en, id);
  if (!d) return Erro("aparelho");
  IAudioEndpointVolume* vol = nullptr;
  HRESULT hr = d->Activate(__uuidof(IAudioEndpointVolume), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&vol));
  d->Release();
  if (FAILED(hr)) return Erro("volume");
  const long n = wcstol(valor, nullptr, 10);
  if (mudo) hr = vol->SetMute(n ? TRUE : FALSE, nullptr);
  else hr = vol->SetMasterVolumeLevelScalar(static_cast<float>(n < 0 ? 0 : n > 100 ? 100 : n) / 100.0f, nullptr);
  vol->Release();
  return FAILED(hr) ? Erro("falhou") : Ok();
}

int wmain(int argc, wchar_t** argv) {
  if (FAILED(CoInitializeEx(nullptr, COINIT_MULTITHREADED))) return 1;
  IMMDeviceEnumerator* en = nullptr;
  int codigo = 1;
  if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&en)))) {
    if (argc == 2 && !wcscmp(argv[1], L"--listar")) {
      printf("{\"saidas\":%s,\"microfones\":%s}\n", Lista(en, eRender).c_str(), Lista(en, eCapture).c_str());
      codigo = 0;
    } else if (argc == 2 && !wcscmp(argv[1], L"--microfones")) codigo = Microfones(en);
    else if (argc == 4 && !wcscmp(argv[1], L"--padrao")) codigo = Padrao(en, argv[2], argv[3]);
    else if (argc == 4 && !wcscmp(argv[1], L"--volume")) codigo = Volume(en, argv[2], argv[3], false);
    else if (argc == 4 && !wcscmp(argv[1], L"--mudo")) codigo = Volume(en, argv[2], argv[3], true);
    else codigo = Erro("uso");
    en->Release();
  }
  CoUninitialize();
  return codigo;
}
