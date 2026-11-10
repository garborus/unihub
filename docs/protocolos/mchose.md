# Protocolo HID dos headsets MCHOSE

Especificação usada pelo plugin `src/renderer/plugins/headsets/mchose/`.

Legenda:
- **✓**: confirmado com hardware (MCHOSE V9 PRO, pelo dongle e pelo cabo, pela WebHID).
- **(não confirmado)**: ainda não testado com hardware pelo UnusHub.

## Identificação

| Item | Valor |
|---|---|
| Vendor ID USB | `0x291D` ✓ |
| V9 PRO pelo dongle | `291D:385D`, nome `MCHOSE V9 PRO` ✓ |
| V9 PRO no cabo USB | `0D8C:0343`, nome `MCHOSE V9 PRO HEADSET` ✓ |

O mesmo PID do dongle é usado por outros modelos (S9 PRO, G9 PRO, V9). O nome do
produto informado pelo USB é o que diferencia.

**No cabo, o fone vira outro aparelho**: o VID passa a ser o do chip de áudio
(`0x0D8C`, C-Media, usado por outras marcas também), então só conta se o nome
começar com `MCHOSE`. As coleções e os comandos são os mesmos. Enquanto o fone
está no cabo, o dongle continua no sistema mas não responde; o UnusHub esconde
o dongle do mesmo modelo nesse caso ✓.

No cabo o UnusHub mostra só "Carregando · via cabo", sem a bateria: o fone
responde, mas as opções do app do fabricante só valem pelo dongle (2.4G), e
no cabo a carga alterna entre `0x03` e `0x00`. A bateria aparece pelo dongle.

Ao ligar o cabo, o fone no cabo aparece primeiro com **uma interface só** e,
~1 s depois, com as cinco ✓. O sistema nem sempre avisa essa mudança; o
gerenciador HID do UnusHub confere a lista a cada 2 s, comparando também nome
e interfaces de cada aparelho.

Coleções do V9 PRO (todas no mesmo `HIDDevice` no Windows; no cabo faltam `0xFF21` e a página `0x000C` muda de posição) ✓:

| Usage Page | Relatórios | Uso |
|---|---|---|
| `0x000B` (telefonia) | entrada/saída `0x07` | botões de chamada do Windows |
| `0x000C` (consumo) | entrada `0x06` | volume e mídia |
| `0xFF90` | entrada `0x55` | **estado (bateria)**, ver abaixo |
| `0xFF22` | feature `0xAA` | **versão do firmware** |
| `0xFF82` | entrada/saída `0x41` | (não usado pelo UnusHub) |
| `0xFF21` | entrada/saída/feature `0xED` | (não usado pelo UnusHub) |

## Estado: report `0x55`

Pedido e resposta usam o report `0x55` com 63 bytes. A coleção só declara
`0x55` como entrada, mas o envio pelo mesmo ID funciona ✓.

### Bateria ✓

- Pedido: `0x65, 0x01`, depois zeros até 63 bytes.
- Resposta: `0x65, porcentagem, estado`.

| Estado | Significado |
|---|---|
| `0x00` | sem estado; a porcentagem vale ✓ (no cabo com 100%, alternando com `0x03`). |
| `0x02` | em uso (descarregando) ✓ |
| `0x03` | carregando ✓ (no cabo) |
| `0x04` | carregada (não confirmado) |
| `0x1A` | dongle conectado, fone desligado ✓ (vem com porcentagem `0`) |

Logo depois de ligar o cabo, um único pedido recebeu 3 respostas (`0x00`, `0x03`, `0x03`) ✓.

Com o fone desligado o pedido pode ficar sem resposta: o UnusHub tenta 3
vezes, com 1 s de espera, e então mostra "Fone desligado".

### Avisos espontâneos ✓

O dongle manda pelo report `0x55`, sem pedido:

- `0x65, 0, 0x1A` assim que o fone é desligado pelo botão;
- `0x11, 0x01` quando o fone liga e conecta, seguido de uma resposta de bateria.
  O UnusHub pede a bateria na hora ao receber esse aviso.

Ao tirar o cabo, o fone volta para o dongle sozinho e o UnusHub troca de
"via cabo" para "via dongle" sem precisar recarregar ✓.

## Versão do firmware: feature report `0xAA` ✓

1. Enviar o feature report `0xAA` com `0x01, 0x00` e zeros até 63 bytes.
2. Esperar ~300 ms e ler o feature report `0xAA`.
3. Resposta: `[0xAA,] 0x01, d1, d2, d3, d4` → versão `"d1d2d3d4"` (ex.: `0, 0, 3, 6` → `0036`).

Se a leitura falhar, espere mais um pouco e leia de novo (até 3 vezes).

## Versão do dongle ✓

Não vem pelo HID: é o `bcdDevice` do dongle USB, que o Windows guarda no ID
do aparelho (`USB\VID_291D&PID_385D&REV_0012` → versão `0012`). O processo
principal do UnusHub lê esse ID por uma consulta CIM do PowerShell. No cabo o
dongle não está em uso e a linha mostra "Não usado".

## Fora do HID

A sub-aba **Configurações de áudio** (só pelo dongle) não usa o HID: usa APIs
padrão da web sobre o som do fone. O Chromium termina o nome de cada aparelho
de som USB com o VID:PID (ex.: `Headphone (MCHOSE V9 PRO) (291d:385d)`), e é
por ele que o UnusHub acha a saída e o microfone do headset ✓.

- teste de som: duas notas no lado esquerdo, direito ou nos dois (Web Audio);
- retorno de voz: o microfone do headset tocado no próprio headset, com volume;
- atalho para as configurações de som do Windows.

Teste e retorno de voz só funcionam no fone que é a **saída de som padrão do
Windows** ✓. Pedindo outra saída, o Chromium tocou na padrão sem avisar (visto
pela lista de sessões de áudio do Windows com o V9 PRO pelo dongle e com um
JBL TUNE520BT por Bluetooth); com isso, o som de um fone vazava para o outro.

Estas funções do headset **não** passam pelo HID e por isso não estão no UnusHub:

- equalizador, surround virtual, efeitos de som e de microfone: rodam no
  driver de áudio do fabricante (C-Media), instalado no PC, e são ajustados por
  uma biblioteca proprietária desse driver. O app oficial só oferece isso pelo
  dongle (2.4G);
- atualização de firmware: fora do escopo, como nos outros fabricantes.

Os modelos V9 TURBO têm ainda, pelo report `0x55`, o comando `0x22`
(desligamento automático e volume dos bipes). O V9 PRO não usa esse comando.
