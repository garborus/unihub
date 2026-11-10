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
    } else if (argc == 4 && !wcscmp(argv[1], L"--padrao")) codigo = Padrao(en, argv[2], argv[3]);
    else if (argc == 4 && !wcscmp(argv[1], L"--volume")) codigo = Volume(en, argv[2], argv[3], false);
    else if (argc == 4 && !wcscmp(argv[1], L"--mudo")) codigo = Volume(en, argv[2], argv[3], true);
    else codigo = Erro("uso");
    en->Release();
  }
  CoUninitialize();
  return codigo;
}
