// Ponte entre o UnusHub e o efeito de áudio do microfone.
//
// O app (Electron) não acessa memória compartilhada do Windows; ele abre este
// programa e manda o som pela entrada padrão: amostras float de 32 bits, mono,
// 48000 Hz. A ponte escreve no canal no ritmo do relógio.
//
// Uso: ponte.exe                      lê o som da entrada padrão até o fim e envia,
//                                     no volume em que veio
//      ponte.exe --ao-vivo <volume>   volume (0 a 1) que pode mudar com o som tocando.
//                                     Entrada: um uint32 com o número de amostras, as
//                                     amostras e, depois, quantos float32 de volume
//                                     novo o app quiser mandar (a entrada fica aberta)
//      ponte.exe --estado             sai com 0 se há efeito com o canal aberto
// Saída: 0 enviado (ao menos uma parte), 3 nenhum app usou o microfone com o
// efeito durante o som, 4 canal com formato inesperado (só no --estado), 5 entrada
// inválida no modo ao vivo.
// Ao enviar, a ponte só termina quando o som acaba, mesmo sem ninguém ouvindo.

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <vector>
#include "../comum/canal.h"

// Som mais longo que o modo ao vivo aceita (o app limita em 5 minutos).
static const uint32_t MAX_AMOSTRAS = CANAL_TAXA * 60u * 10u;

static int Falhar(const char* erro, int codigo) {
  fprintf(stdout, "{\"ok\":false,\"erro\":\"%s\"}\n", erro);
  return codigo;
}

static bool AbrirCanal(HANDLE& mapa, Canal*& canal);
static int Enviar(HANDLE mapa, Canal* canal, bool aoVivo, float volume);

int wmain(int argc, wchar_t** argv) {
  const bool estado = argc > 1 && !wcscmp(argv[1], L"--estado");
  const bool aoVivo = argc > 2 && !wcscmp(argv[1], L"--ao-vivo");
  HANDLE mapa = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, CANAL_NOME);
  if (estado) {
    if (!mapa) return Falhar("canal", 3);
    Canal* canal = static_cast<Canal*>(MapViewOfFile(mapa, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(Canal)));
    if (!canal || canal->magico != CANAL_MAGICO || canal->versao != CANAL_VERSAO) return Falhar("formato", 4);
    fprintf(stdout, "{\"ok\":true,\"leitores\":%d}\n", canal->leitores);
    return 0;
  }
  if (mapa) CloseHandle(mapa);
  // Enviar: sem canal agora, o som toca no relógio e entra se um app abrir o microfone.
  Canal* canal = nullptr;
  mapa = nullptr;
  AbrirCanal(mapa, canal);
  return Enviar(mapa, canal, aoVivo, aoVivo ? static_cast<float>(_wtof(argv[2])) : 1.0f);
}

// Abre o canal, se algum app já estiver usando o microfone com o efeito.
static bool AbrirCanal(HANDLE& mapa, Canal*& canal) {
  mapa = OpenFileMappingW(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, CANAL_NOME);
  if (!mapa) return false;
  canal = static_cast<Canal*>(MapViewOfFile(mapa, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(Canal)));
  if (!canal || canal->magico != CANAL_MAGICO || canal->versao != CANAL_VERSAO) {
    if (canal) UnmapViewOfFile(canal);
    CloseHandle(mapa);
    mapa = nullptr;
    canal = nullptr;
    return false;
  }
  return true;
}

// Lê exatamente `bytes` da entrada (ou o que houver até ela fechar); devolve o que leu.
// Direto pelo Windows, sem a memória intermediária do C: no modo ao vivo é preciso
// saber quantos bytes ainda estão na entrada.
static size_t Ler(HANDLE entrada, void* destino, size_t bytes) {
  size_t total = 0;
  while (total < bytes) {
    const DWORD pedir = static_cast<DWORD>(bytes - total > (1u << 20) ? (1u << 20) : bytes - total);
    DWORD lidos = 0;
    if (!ReadFile(entrada, static_cast<char*>(destino) + total, pedir, &lidos, nullptr) || lidos == 0) break;
    total += lidos;
  }
  return total;
}

static float Limitar(float v) {
  if (!(v == v)) return 1.0f; // NaN
  return v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
}

// O som "toca" do começo ao fim no relógio, mesmo sem ninguém ouvindo. Enquanto
// nenhum app usa o microfone, procura o canal a cada 100 ms; se um app abrir o
// microfone no meio, entra dali para frente (o que já passou não volta).
// Escreve com até 200 ms de folga à frente do relógio, para não passar quem lê;
// por isso uma mudança de volume leva até 200 ms para chegar ao microfone.
static int Enviar(HANDLE mapa, Canal* canal, bool aoVivo, float volumeInicial) {
  const HANDLE entrada = GetStdHandle(STD_INPUT_HANDLE);
  std::vector<float> som;
  if (aoVivo) {
    uint32_t n = 0;
    if (Ler(entrada, &n, sizeof(n)) != sizeof(n) || n == 0 || n > MAX_AMOSTRAS) return Falhar("entrada", 5);
    som.resize(n);
    if (Ler(entrada, som.data(), static_cast<size_t>(n) * sizeof(float)) != static_cast<size_t>(n) * sizeof(float)) return Falhar("entrada", 5);
  } else {
    float bloco[4096];
    size_t lidos;
    while ((lidos = Ler(entrada, bloco, sizeof(bloco))) >= sizeof(float)) som.insert(som.end(), bloco, bloco + lidos / sizeof(float));
  }

  // Prioridade alta enquanto envia: com o processador ocupado (um jogo aberto), a
  // ponte não pode ficar mais de 200 ms sem rodar, senão o som falha. Ela quase não
  // gasta processador: escreve um pouco e dorme.
  SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);

  // Volume: `alvo` é o pedido; `volume` vai até ele aos poucos (uns 20 ms), para a
  // mudança não dar estalo.
  float alvo = Limitar(volumeInicial);
  float volume = alvo;

  const int64_t folga = CANAL_TAXA / 5;
  LARGE_INTEGER freq, inicio, agora;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&inicio);
  size_t enviado = 0;
  int64_t entrou = canal ? 0 : -1; // amostra em que o canal apareceu (-1: nunca)
  int64_t ultimaBusca = 0;
  for (;;) {
    // Volume novo mandado pelo app (só lê o que já chegou; nunca espera).
    if (aoVivo) {
      DWORD disponivel = 0;
      while (PeekNamedPipe(entrada, nullptr, 0, nullptr, &disponivel, nullptr) && disponivel >= sizeof(float)) {
        float v = 1.0f;
        if (Ler(entrada, &v, sizeof(v)) != sizeof(v)) break;
        alvo = Limitar(v);
      }
    }
    QueryPerformanceCounter(&agora);
    const int64_t relogio = (agora.QuadPart - inicio.QuadPart) * CANAL_TAXA / freq.QuadPart;
    if (relogio >= static_cast<int64_t>(som.size()) && (!canal || enviado >= som.size())) break;
    if (!canal) {
      if (relogio - ultimaBusca >= static_cast<int64_t>(CANAL_TAXA / 10)) {
        ultimaBusca = relogio;
        if (AbrirCanal(mapa, canal)) {
          entrou = relogio;
          enviado = static_cast<size_t>(relogio); // pula o que já passou
          volume = alvo;
        }
      }
    } else {
      const int64_t limite = relogio + folga;
      while (enviado < som.size() && static_cast<int64_t>(enviado) < limite) {
        volume += (alvo - volume) * 0.002f;
        const int64_t pos = canal->escritos;
        canal->dados[pos % CANAL_QUADROS] = som[enviado++] * volume; // tamanho fixo, nunca o escrito no canal
        MemoryBarrier();
        InterlockedExchange64(&canal->escritos, pos + 1);
      }
    }
    Sleep(10);
  }
  if (!canal) {
    fprintf(stdout, "{\"ok\":false,\"erro\":\"canal\",\"amostras\":%zu}\n", som.size());
    return 3;
  }
  fprintf(stdout, "{\"ok\":true,\"leitores\":%d,\"amostras\":%zu,\"entrou\":%lld}\n", canal->leitores, som.size(), entrou);
  UnmapViewOfFile(canal);
  CloseHandle(mapa);
  return 0;
}
