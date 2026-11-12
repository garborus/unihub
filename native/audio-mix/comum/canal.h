// Canal entre o UniHub (pela ponte) e o efeito de áudio que roda no microfone.
//
// Memória compartilhada com um anel de amostras: a ponte escreve, cada cópia do
// efeito lê na própria posição. Formato fixo: mono, float de 32 bits, 48000 Hz;
// o efeito converte para o formato do microfone. A ponte escreve no ritmo do
// relógio, então não precisa saber quem lê.

#pragma once
#include <stdint.h>

// CLSID do efeito, como texto: é o que fica nas listas de efeitos do microfone no
// registro. O mesmo desde a primeira versão (ver efeito/MixApo.cpp e instalador/).
#define EFEITO_CLSID_TEXTO L"{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}"

#ifndef CANAL_NOME // o teste local troca por um nome Local\, que não exige privilégio
#define CANAL_NOME      L"Global\\UniHubAudioMixCanal1"
#endif
#define CANAL_MAGICO    0x42554855u  // "UHUB"
#define CANAL_VERSAO    1u
#define CANAL_TAXA      48000u
#define CANAL_QUADROS   (CANAL_TAXA * 4u) // 4 segundos de anel

struct Canal {
  uint32_t magico;
  uint32_t versao;
  uint32_t taxa;
  uint32_t quadros;           // tamanho do anel, em amostras
  volatile int64_t escritos;  // total de amostras já escritas (só cresce)
  volatile int32_t leitores;  // cópias do efeito com o canal aberto
  uint32_t reservado;
  float dados[CANAL_QUADROS];
};
