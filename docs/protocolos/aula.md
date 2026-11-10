# AULA série F (teclados)

Código em `src/renderer/plugins/teclados/aula/`, usado pela aba Teclados:
`devices.js` (reconhecimento), `protocol.js` (pacotes, funções puras),
`session.js` (conversa com o teclado) e `lights-tab.js` (aba Luzes).

**Estado:** reconhecimento pelo USB, nome, desenho do teste de teclas e aba
**Luzes** (efeito, brilho, velocidade e as 7 cores de cada efeito), pelo cabo e
pelo receptor, e bateria pelo receptor. Testado com um **AULA F75**.

> Tudo aqui é **só da AULA série F**: comandos, efeitos, posições dos bytes e a
> aba Luzes. Outras marcas de teclado têm protocolos próprios e não usam nada
> deste arquivo.

## Aparelhos

| Modelo | Formato | No cabo | Receptor 2.4G |
|---|---|---|---|
| F75 | 75%, botão de volume | `258A:010C` | `3554:FA09` |
| F87 | TKL (sem teclado numérico) | `258A:010C` | `3554:FA09` |
| F99 | 96% | `258A:010C` | `3554:FA09` |

- Os três modelos usam os mesmos códigos: o modelo não aparece pelo USB, então
  o usuário escolhe o seu na aba Dispositivo (fica salvo no computador).
- `258A` é o fabricante do chip (SINO WEALTH), usado por várias marcas, e
  `3554` também aparece em receptores de mouse de outras marcas. Um aparelho
  com esses códigos é mostrado como "AULA série F" até o usuário escolher o
  modelo.
- O receptor tem interface de teclado e de mouse. Com o cabo ligado, o teclado
  usa o cabo e o receptor fica de fora da lista.
- O receptor continua aparecendo com o teclado desligado: sem o protocolo, não
  dá para saber se o teclado está ligado.

## Interfaces HID (F75 no cabo)

| Interface | Coleções |
|---|---|
| 1 | Generic Desktop 0x80, Consumer 0x01, vendor `0xFF00` (×3), Mouse, Keyboard |
| 2 | Keyboard |

As coleções `0xFF00` são as de configuração (luzes, macros, troca de teclas).

## Protocolo pelo receptor 2.4G (confirmado com F75)

Interface `0xFF02` do receptor, relatório `0x13` de entrada e saída (19 bytes
sem o ID). Pacote completo, contando o ID:

| Byte | Conteúdo |
|---|---|
| 0 | `0x13` (ID do relatório) |
| 1 | comando |
| 2 | total de pacotes |
| 3 | número deste pacote (0, 1, …) |
| 4 | `(sub << 4) \| tamanho` (até 14) |
| 5–18 | dados |
| 19 | soma dos bytes 0–18 (8 bits) |

- **Gravar:** os dados vão em pacotes de 14 bytes; o teclado responde a cada
  pacote com o mesmo comando e número.
- **Ler:** pedido com total 1 e sem dados; o teclado responde com os pacotes
  do bloco, no mesmo formato.

| Comando | O que faz |
|---|---|
| `0x44` / `0x04` | lê / grava o bloco de luz (128 bytes, termina em `5A A5`) |
| `0x49` / `0x09` | lê / grava a tabela de cores (gravação: 512 bytes, `5A A5` em `0x1FA`) |
| `0x4A` | lê a bateria: 2 bytes, porcentagem e estado (carregando quando os 4 bits de cima do 2º byte estão ligados e os de baixo não). Visto no F75 a 100%: `01` sem cabo, `11` com cabo (cheia, não carregando); o `10` (carregando) ainda não foi visto |

### Bloco de luz (128 bytes)

| Byte | Conteúdo |
|---|---|
| 10 | efeito atual (código abaixo) |
| `0x3A + 2 × (código − 1)` | brilho do efeito, 0 (apagado) a 9 no F75; 0 a 4 no F87 e no F99 |
| `0x3B + 2 × (código − 1)`, 4 bits de cima | velocidade do efeito, 0 (lenta) a 4 (rápida) |
| `0x3B + 2 × (código − 1)`, 4 bits de baixo | modo de cor do efeito: `0` a `6` = cor 0 a 6 da linha do efeito na tabela de cores; `7` = colorido |
| 126–127 | `5A A5` |

Dois bytes por efeito, a partir do efeito 1 em `0x3A`. Velocidade e modo de
cor dividem um byte: para mudar um, trocar só os 4 bits dele. (Confirmado com o
app oficial: brilho 0 no Respirar zera o `0x3C`.)

Para mudar, ler o bloco, alterar só o necessário e gravar de volta. Brilho,
velocidade e cor valem na hora, sem trocar de efeito.

Códigos de efeito (a ordem da lista de efeitos; **confirmados: 1 e 2**):
1 sempre ligado, 2 respirar, 3 arco-íris, 4 desaparecer rapidamente,
5 gotas de chuva, 6 roda arco-íris, 7 ondulações brilhantes, 8 brilhos de
estrela, 9 desaparecimento em sombra, 10 cobra retrô, 11 fluxo de neon,
12 reação, 13 onda senoidal, 14 digitalização contínua, 15 moinho de vento
giratório, 16 cachoeira colorida, 17 florescendo, 18 tempestade giratória
(fora da lista do UnusHub).

### Tabela de cores

7 cores RGB por efeito (21 bytes, na ordem R, G, B), na posição
`código × 21`. O modo de cor *n* do efeito usa a cor *n* da linha (conferido
de 0 a 6 no Sempre ligado). Padrão de fábrica de cada linha: vermelho, verde,
azul, amarelo, rosa, ciano, branco. O app oficial grava a cor escolhida na
cor 0 e põe o modo em `0`, o que pode repetir uma cor da linha; o botão
**Restaurar cores** da aba Luzes grava de volta o padrão de fábrica do efeito.

## Protocolo pelo cabo (confirmado com F75)

Interface `0xFF00` do teclado (`258A:010C`), relatório de configuração (feature)
`0x06`, 520 bytes contando o ID. Sem soma de conferência.

| Byte | Conteúdo |
|---|---|
| 0 | `0x06` (ID do relatório) |
| 1 | comando |
| 2 | sub-comando |
| 3 | `0x00` |
| 4 | total de pacotes |
| 5 | número deste pacote |
| 6–7 | tamanho dos dados (little-endian) |
| 8– | dados (até 512 bytes) |

- **Gravar:** envia o relatório com os dados.
- **Ler:** envia o pedido (comando com o bit `0x80`, sem dados) e lê o mesmo
  relatório: volta o mesmo cabeçalho e os dados a partir do byte 8.

| Comando | O que faz |
|---|---|
| `0x84` / `0x04` | lê / grava o bloco de luz (o mesmo do receptor) |
| `0x8A` / `0x0A` | lê (490 bytes) / grava (512 bytes, `5A A5` em `0x1FA`) a tabela de cores |
| `0x03` | grava a matriz de teclas (sub = camada) |
| `0x05` | grava as macros |
| `0x11` | **restaura o padrão de fábrica**: não usar sem pedir ao usuário |

**Ainda não confirmado:** os códigos de efeito de 3 a 18 e o "desligado". O app oficial aberto ao mesmo
tempo mistura as respostas pelo receptor: as leituras vêm incompletas. Com o
sinal fraco, ou com o cabo ligado e a chave no sem fio, pacotes se perdem: o
UnusHub soma os pacotes de várias leituras e reenvia o pacote de gravação sem
confirmação (confirmado com F75).

## Funções do teclado ainda não implementadas

- Luz com o som do sistema e cor por tecla.
- Troca de função das teclas em três camadas (padrão, FN1, FN2): tecla,
  combinação, mídia, botão de mouse, comando do Windows, macro ou desligar.
- Macros gravadas no teclado.
- Bloqueio da tecla Win, anti-rebote, tempo de suspensão no sem fio (1 a 20 min),
  restaurar padrão de fábrica.
- Versão do firmware.
