# Logitech HID++ 2.0

Código em `src/renderer/plugins/headsets/logitech/` (`hidpp.js` e `session.js`), usado
pela aba Headsets para os headsets Logitech. O HID++ tem documentação
pública da própria Logitech e de projetos como Solaar e libratbag. O UnusHub
implementa só o necessário, a partir dessas especificações.

**Estado:** implementado a partir da especificação, **ainda não testado com
hardware Logitech** pelo UnusHub.

## Relatórios

| Report | Tamanho total | Uso |
|---|---|---|
| `0x10` | 7 bytes | curto |
| `0x11` | 20 bytes | longo (preferido quando existe) |

Interfaces: Usage Page `0xFF00` (receptores Unifying/Bolt/Lightspeed) ou `0xFF43` (dispositivos com cabo).

## Mensagem

`[report, índiceDispositivo, índiceFeature, (função << 4) | softwareId, parâmetros…]`

- `índiceDispositivo`: `0xFF` = dispositivo direto; `1–6` = pareados no receptor.
- `softwareId`: 1–15, identifica nossas respostas (o UnusHub usa `0x0B`).
- Erro HID++ 2.0: `índiceFeature = 0xFF`, depois `featureOriginal, funçãoOriginal, código`.
- Erro HID++ 1.0: `0x8F` no lugar do índice da feature.

## Features usadas

| Feature | ID | Função |
|---|---|---|
| Root | `0x0000` (índice 0) | fn0 `getFeature(id)` → índice · fn1 `ping` → versão do protocolo |
| Device name | `0x0005` | fn0 tamanho · fn1 nome a partir do índice · fn2 tipo |
| Battery status | `0x1000` | fn0 → %, próximo nível, estado |
| Unified battery | `0x1004` | fn1 → %, nível, estado de carga |

## Headsets

Aparelhos que o HID++ informa como tipo **Headset** (feature `0x0005`, função 2,
valor 8) também aparecem na aba **Headsets**, com nome, bateria e versão do
protocolo, e com as Configurações de áudio (o som do fone é achado pelo VID:PID
da interface). O código fica em `src/renderer/plugins/headsets/logitech/headsets.js`.
Ainda não testado com um headset Logitech.

## Próximos passos

- `0x2201` DPI ajustável
- `0x8070` / `0x8071` iluminação RGB
- `0x8100` perfis onboard
- `0x1B04` remapeamento de botões
