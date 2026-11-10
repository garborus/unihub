// Ponte entre o UniHub e o efeito de áudio do microfone.
//
// O app (Electron) não acessa memória compartilhada do Windows; ele abre este
// programa e manda o som pela entrada padrão: amostras float de 32 bits, mono,
// 48000 Hz, já no volume certo. A ponte escreve no canal no ritmo do relógio.
//
// Uso: ponte.exe            (lê o som da entrada padrão e envia)
//      ponte.exe --estado   (sai com 0 se há efeito com o canal aberto)
// Saída: 0 enviado (ao menos uma parte), 3 nenhum app usou o microfone com o
// efeito durante o som, 4 canal com formato inesperado (só no --estado).
// Ao enviar, a ponte só termina quando o som acaba, mesmo sem ninguém ouvindo.

#include <windows.h>
#include <stdio.h>
#include <string.h>
#include <io.h>
#include <fcntl.h>
#include <vector>
#include "../comum/canal.h"

static int Falhar(const char* erro, int codigo) {
  fprintf(stdout, "{\"ok\":false,\"erro\":\"%s\"}\n", erro);
  return codigo;
}

static bool AbrirCanal(HANDLE& mapa, Canal*& canal);
static int Enviar(HANDLE mapa, Canal* canal);

int wmain(int argc, wchar_t** argv) {
  const bool estado = argc > 1 && !wcscmp(argv[1], L"--estado");
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
  return Enviar(mapa, canal);
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

// O som "toca" do começo ao fim no relógio, mesmo sem ninguém ouvindo. Enquanto
// nenhum app usa o microfone, procura o canal a cada 100 ms; se um app abrir o
// microfone no meio, entra dali para frente (o que já passou não volta).
// Escreve com até 200 ms de folga à frente do relógio, para não passar quem lê.
static int Enviar(HANDLE mapa, Canal* canal) {
  _setmode(_fileno(stdin), _O_BINARY);
  std::vector<float> som;
  float bloco[4096];
  size_t n;
  while ((n = fread(bloco, sizeof(float), 4096, stdin)) > 0) som.insert(som.end(), bloco, bloco + n);

  const int64_t folga = CANAL_TAXA / 5;
  LARGE_INTEGER freq, inicio, agora;
  QueryPerformanceFrequency(&freq);
  QueryPerformanceCounter(&inicio);
  size_t enviado = 0;
  int64_t entrou = canal ? 0 : -1; // amostra em que o canal apareceu (-1: nunca)
  int64_t ultimaBusca = 0;
  for (;;) {
    QueryPerformanceCounter(&agora);
    const int64_t relogio = (agora.QuadPart - inicio.QuadPart) * CANAL_TAXA / freq.QuadPart;
    if (relogio >= static_cast<int64_t>(som.size()) && (!canal || enviado >= som.size())) break;
    if (!canal) {
      if (relogio - ultimaBusca >= static_cast<int64_t>(CANAL_TAXA / 10)) {
        ultimaBusca = relogio;
        if (AbrirCanal(mapa, canal)) {
          entrou = relogio;
          enviado = static_cast<size_t>(relogio); // pula o que já passou
        }
      }
    } else {
      const int64_t limite = relogio + folga;
      while (enviado < som.size() && static_cast<int64_t>(enviado) < limite) {
        const int64_t pos = canal->escritos;
        canal->dados[pos % canal->quadros] = som[enviado++];
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
