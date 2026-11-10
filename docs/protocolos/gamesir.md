# Protocolo de configuração GameSir

Especificação usada pelo plugin `src/renderer/plugins/gamepads/gamesir/`: bytes,
tamanhos e comportamentos da interface de configuração dos controles GameSir.

Legenda:
- **✓**: confirmado com hardware (GameSir Cyclone 2, pela WebHID).
- **(não confirmado)**: ainda não testado com hardware pelo UnusHub.

## Identificação

| Item | Valor |
|---|---|
| Vendor ID USB | `0x3537` ✓ |
| Interface de configuração | coleção com Usage Page `0xFFF0`, Usage `0x0040` ✓ |
| Relatórios dessa coleção | saída `0x0F` (63 bytes) · entrada `0x10` e `0x12` (63 bytes cada) ✓ |

Interfaces GameSir sem essa coleção usam outro protocolo e ainda não são suportadas.

O mesmo controle muda de PID conforme o modo. Exemplo: Cyclone 2 em modo Xbox,
`0x1053` via cabo e `0x100B` via dongle ✓. Por isso o plugin identifica pela
**página de uso**, não por uma tabela de PIDs.

### Modos do Cyclone 2

A cor do botão Home indica o modo. Para trocar, use Home junto com um dos botões
de ação, pela posição:

| Cor | Modo | Botão de ação | Plataforma | IDs no PC |
|---|---|---|---|---|
| Verde | XInput | esquerda | Windows 10+, Android 8+ | `0x3537` / `0x100B` via dongle, `0x1053` via cabo ✓ |
| Vermelho | Nintendo Switch | cima | Switch | `0x057E` / `0x2009`, via dongle e via Bluetooth ✓ |
| Azul | DualShock 4 | direita | Windows 10+, iOS 13+ | `0x054C` / `0x09CC`, "Wireless Controller", via Bluetooth ✓ |
| Amarelo | HID | baixo | Android 8+ | (não confirmado) |

Nos modos Switch e DualShock 4, os IDs são os da Nintendo e da Sony: o PC não
distingue o controle de um Pro Controller ou de um DualShock 4, e o plugin o trata
como gamepad genérico, sem as opções da GameSir ✓.

L4 e R4 são os paddles traseiros do Cyclone 2: botões extras, customizáveis, para o
jogador usar sem tirar os dedos dos analógicos.

No modo Switch, o nome muda com a conexão: "Pro Controller" no dongle; por Bluetooth,
"Pro Controller" na lista de aparelhos e "Wireless Gamepad" na interface de jogo ✓.
O plugin mostra "Pro Controller" nos dois casos.

### Conexões do Cyclone 2

O indicador Home fica aceso e fixo quando a conexão é bem-sucedida.

| Conexão | Como conectar | Sinal durante o pareamento |
|---|---|---|
| Cabo | cabo USB-C | nenhum |
| Bluetooth | segurar Home + botão de ação da direita por 2 s; no PC, conectar a "Wireless Controller" | Home pisca em azul |
| Dongle | ligar o dongle no USB; segurar Home + botão de ação da esquerda por 2 s | Home pisca em verde; o indicador do dongle pisca |

Se a conexão falhar, Home + Share por 2 s volta ao pareamento. No dongle, aperte
também o botão de pareamento dele.

## Enquadramento

- **Comando (app → controle):** report `0x0F`, seguido de `cmd`, dos parâmetros e de zeros até 63 bytes. ✓
- **Resposta (controle → app):** report `0x10`, primeiro byte = `cmd + 1`, seguido dos dados. ✓
- **Estado (controle → app):** report `0x12`, enviado continuamente (centenas por segundo) enquanto o controle recebe o heartbeat. ✓
  - bytes 0–3: sticks (`0x80` = centro); byte 4: direcional (`0x0F` = solto); bytes 5–6: botões; bytes 7–8: gatilhos ✓
  - byte 4, metade alta: botões de ação, `0x20` = A ✓
  - Contando o report ID como byte 0, no Cyclone 2 em modo XInput via dongle ✓: byte 7, bit `0x02`: Captura; byte 60: `0x02` Captura, `0x08` L4, `0x10` R4, `0x20` M. A Gamepad API não informa esses quatro botões
  - bytes 9 em diante: sensores de movimento, que variam mesmo com o controle parado ✓
  - byte 35 (contando o report ID como byte 0): estado de carga, `1` = carregando ✓ (via cabo a 57%; via cabo a 100% e via dongle vem `0`)
  - byte 36: bateria em % (0–100) ✓ — um dongle sem controle manda tudo zerado

## Comandos

| cmd | Nome | Parâmetros | Resposta |
|---|---|---|---|
| `0x01` | entrar no modo de configuração | — | (não confirmado) |
| `0x02` | sair do modo de configuração | `salvar` (0/1) | (não confirmado) |
| `0x03` | gravar bloco | `slot, offHi, offLo, tamanho, dados…` | `0x06` ✓ |
| `0x04` | ler bloco | `slot, offHi, offLo, tamanho` | `0x05, …` ✓ |
| `0x07` | trocar perfil | `slot` (1–4; 5 = Shift) | ✓ |
| `0x09` | versão do firmware | — | `0x0A` + dígitos UTF-16LE em grupos de 4 ✓ |
| `0x0B` | perfil atual | — | `0x0C, slot` ✓ |
| `0x0D` | prévia da animação de luz | `tocando (0/1), quadro` | ✓ |
| `0x10` | ler perfil por offset | `slot, offHi, offLo, tamanho` | (não confirmado) |
| `0x20` | vibração | `0x66, 0x55, esquerdo, direito` (0–255) | ✓ |
| `0xF2` | heartbeat | `modoTeste` (0/1) | ✓ |
| `0xFC` | entrar em modo de atualização | — | **não usar** (ver abaixo) |
| `0xFD` | calibração | `estado` | (não confirmado) |

### Versão do firmware ✓

Dígitos ASCII codificados como UTF-16LE, em grupos de 4:

- via cabo: `"0356"` → controle **3.56**
- via dongle: `"03560121"` → controle **3.56**, dongle **1.21**

### Perfis

- 4 perfis + perfil Shift (5) + bloco de iluminação (32).
- Perfil de botões: 680 bytes. É lido/gravado em blocos de **58 bytes**
  (64 − cabeçalho de 6), com offset de 16 bits big-endian. (não confirmado para gravação)
- O layout interno (mapeamento, sticks, gatilhos, motores) **muda entre
  modelos**. Use o backup bruto (aba Perfis) para documentar cada modelo aqui
  antes de liberar a gravação.

### Mapeamento de botões ✓ no Cyclone 2

Perfil de botões (slots 1–4, 680 bytes):

| Offset | Tamanho | Campo |
|---|---|---|
| 0 | 32 | nome do perfil (UTF-8) |
| 32 | 32 | configurações gerais (32–33: força dos motores esquerdo/direito; 46: taxa de relatório) |
| 64 | 16 × 7 | botões, nesta ordem: ↑ ↓ ← → LB RB L3 R3 A B X Y Home View Menu Captura |

Paddles do Cyclone 2, com o mesmo formato de 7 bytes dos botões ✓:

| Offset | Botão | Padrão de fábrica |
|---|---|---|
| 176 | L4 | `00 00 01 11 00 00 00` (código próprio `17`) |
| 335 | R4 | `00 00 01 12 00 00 00` (código próprio `18`) |

Confirmado gravando o destino A em L4 e B em R4 no perfil 4: com esse perfil ativo, os
dois passaram a gerar A e B. Os dados são iguais nos 4 perfis.

Gatilhos do Cyclone 2: cada um tem um bloco de ajustes de 28 bytes (LT em 496, RT em
524). A entrada de 7 bytes do remapeamento, no mesmo formato dos botões, começa 3 bytes
depois do início do bloco. Diferente dos paddles, o padrão é **não mapeado**:

| Offset | Botão | Padrão de fábrica |
|---|---|---|
| 499 | LT | `00 64 00 00 00 00 00` |
| 527 | RT | `00 64 00 00 00 00 00` (não confirmado na gravação) |

Confirmado no perfil 1 ✓: com o LT mapeado para A (`00 64 01 09 00 00 00`), apertar o
LT gera A; voltando o byte 2 e o destino a `0`, o LT volta a ser gatilho. Os outros
bytes do bloco parecem ser a curva/zona morta do gatilho (não confirmado) e não
precisam mudar para o remapeamento funcionar.

Cada botão (7 bytes):

| Byte | Campo |
|---|---|
| 0 | turbo ligado (0/1) (não confirmado) |
| 1 | velocidade do turbo (não confirmado) |
| 2 | mapeado (`0` = faz a própria função, `1` = usa o destino) ✓ |
| 3 | destino 1 ✓ |
| 4–5 | destinos 2 e 3 (combinação de teclas) (não confirmado) |
| 6 | alternar (não confirmado) |

Códigos de destino: ↑ `1`, ↓ `2`, ← `3`, → `4`, LB `5`, RB `6`, L3 `7`, R3 `8`,
A `9`, B `10`, X `11`, Y `12`, Home `13`, View `14`, Menu `15`, Captura `16`,
LT `19`, RT `20`, stick esquerdo ↑↓←→ `21`–`24`, stick direito ↑↓←→ `25`–`28`,
desativado `255`. Teclado `50`–`155` e mouse `200`–`206` (não confirmados).

Confirmado gravando `0, 0, 1, 10, 0, 0, 0` no botão A do perfil 4: com o perfil
4 ativo, apertar A passou a gerar B.

### Taxa de relatório ✓ no Cyclone 2

Quantas vezes por segundo o controle envia o estado ao PC. Fica em **1 byte
no offset 46 de cada perfil de botões** (slots 1–4) e guarda uma "marcha":

| Marcha | Taxa |
|---|---|
| `0` | 250 Hz |
| `1` | 500 Hz |
| `2` | 1000 Hz (padrão) |

- Ler: `0x04, slot, 0x00, 0x2E, 0x01` → resposta com 1 byte.
- Gravar: `0x03, slot, 0x00, 0x2E, 0x01, marcha` → confirmação `0x06`.
- O UnusHub grava a mesma marcha nos 4 perfis, para a taxa não mudar ao trocar de perfil.

### Leitura e gravação de blocos ✓

- Ler: `0x04, slot, offHi, offLo, tamanho` → resposta `0x05, slot, offHi, offLo, tamanho, dados…`.
- Gravar: `0x03, slot, offHi, offLo, tamanho, dados…` → confirmação `0x06`.
  `0x06, 0x01` significa "ocupado": espere e reenvie.
- `0x0F` sem ter sido pedido avisa que o perfil mudou no controle. (não confirmado)

### Bloco de iluminação (slot 32, 635 bytes) ✓ no Cyclone 2

| Offset | Tamanho | Campo |
|---|---|---|
| 0 | 1 | animação ativa (0–3) |
| 1 | 5 × 124 | animações 1–5 (a interface usa só as 4 primeiras) |
| 621 | 1 | bit 0 = modo reativo a áudio |
| 622 | 1 | índice de efeito do usuário (preservar) |
| 623 | 3 | cor RGB do LED de perfil (preservar) |
| 626 | 1 | bit 0 = "segure para despertar" (nome interno: levantar para despertar). Posição ✓ (é o mesmo byte que muda ao trocar a opção no app do fabricante) e persiste ao desligar. **Efeito no Cyclone 2 não identificado**: ligar o controle, acordar da suspensão e levantar o controle com as luzes apagadas se comportaram igual com `0` e `1`. |
| 627 | 1 | suspender quando inativo (minutos; 0 = desativado; opções: 0, 1, 5, 10, 20) |
| 628 | 7 | reservado (preservar) |

Cada animação (124 bytes):

| Offset | Campo |
|---|---|
| 0 | número de quadros-chave (1–8) |
| 1 | tipo de efeito: sempre `5` |
| 2 | velocidade, invertida: `bruto = 20 − velocidade` (velocidade 0–20) |
| 3 | brilho (0–100) |
| 4 | 8 quadros × 5 LEDs × RGB (120 bytes) |

Posição física dos LEDs no **Cyclone 2** (as 4 luzes da interface):

| Luz | Posição | LED no bloco |
|---|---|---|
| 1 | esquerda | 0 |
| 2 | cima | 3 |
| 3 | direita | 1 |
| 4 | baixo | 4 |
| — | (não usado) | 2 |

O mapa foi confirmado lendo o bloco do controle e comparando com as cores de
cada luz nas animações I, II e IV.

### Prévia da animação ✓

`0x0D, tocando (0/1), quadro` faz o controle tocar a animação ou parar num
quadro-chave (1 = primeiro). É assim que o editor mostra no controle o quadro
que está sendo editado.

## Heartbeat ✓

O UnusHub manda `0xF2` a cada 1 s, só com a janela em foco. Sem o heartbeat o
controle não envia o relatório de estado `0x12`.

## Fila e confirmação

Um comando por vez por controle. Sem resposta em ~200 ms, reenviar, até 10
tentativas. A implementação está em `src/renderer/core/command-queue.js`.

## Firmware: fora do escopo por enquanto

O comando `0xFC` coloca o controle em modo de atualização de firmware. Para
suportar isso seria preciso:

1. Documentar aqui o protocolo de gravação de firmware.
2. Implementá-lo validando modelo (PID/VID gravado no arquivo) e CRC antes de gravar.
3. **Não** distribuir os arquivos de firmware: o usuário obtém o arquivo do fabricante.

Um erro nessa etapa pode inutilizar o controle. Por isso ela não está no UnusHub.
