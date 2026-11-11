# UnusHub

Um só app para configurar periféricos de vários fabricantes, no lugar de um "hub"
oficial de cada marca. Cada tipo de aparelho (controles, headsets, teclados…) é uma aba que
reconhece qualquer marca, com opções extras para as marcas cujo protocolo o
UnusHub já conhece (GameSir, MCHOSE, Logitech…).


## Estado

| Aba | Estado | O que faz |
|---|---|---|
| Gamepads | beta | todos os controles de jogo conectados, com teste de botões visual e informações. **Controles GameSir** (testado com Cyclone 2) ganham também: **editor de luzes** (animações, predefinições, quadros-chave, cores, brilho, velocidade, áudio, despertar, suspensão, indicador de perfil), vibração com animação, **mapeamento de botões** por perfil, taxa de relatório, bateria com aviso, backup de perfis, firmware |
| Headsets | beta | fones e headsets de **qualquer marca**, pelo dongle, cabo USB ou Bluetooth: **Configurações de áudio** (teste de som esquerdo/direito, retorno do microfone, atalho para o som do Windows; funcionam no fone que é a saída de som padrão do Windows), informações do aparelho e, **por Bluetooth, a bateria** (lida do Windows, com aviso de bateria baixa). **Headsets Logitech** (HID++, **não testado com hardware**) ganham nome e bateria. **Headsets MCHOSE** (testado com V9 PRO) ganham também, pelo dongle, bateria com estado de carga e versão do firmware. Equalizador e surround ainda não (dependem do driver de áudio do fabricante) |
| Teclados | beta | teclados de **qualquer marca**, com fio, pelo dongle, por **Bluetooth** (com o nome do aparelho) e o **teclado do notebook** (PS/2 ou interno, pela lista do Windows; testados só com exemplos): informações do aparelho (fabricante pelo VID, VID:PID) e **teste de teclas** visual (teclado padrão no layout do sistema, ou o desenho do modelo nas marcas conhecidas; teclas testadas, quantas teclas juntas). O teste usa as teclas que o Windows recebe, de qualquer teclado. **Teclados AULA série F** (testado com F75) são reconhecidos no cabo e pelo dongle 2.4G, com o modelo escolhido pelo usuário, o desenho de cada modelo no teste (F75, F87 e F99), a aba **Luzes** (efeito, brilho, velocidade e 7 cores por efeito) e, pelo dongle, a **bateria** com aviso de bateria baixa. Macros e troca de teclas ainda não |
| Sons | beta | guarda áudios e toca cada um no fone, no microfone ou nos dois, com volume separado para cada um. Para quem está na chamada ouvir: pelo **efeito no microfone** (efeito de áudio do UnusHub, instalado pela própria aba com permissão de administrador; funciona nos apps que deixam os efeitos do microfone ligados, como o Gravador de Som, e pode não funcionar no Discord) ou por um **cabo de áudio virtual** (ex.: VB-CABLE), com a opção de misturar a sua voz |
| Dispositivos HID | ferramenta | lista todas as interfaces HID, para começar um novo hub |

As abas só aparecem depois que você as ativa em **Configurações › Adicionar aba**
(engrenagem no menu).
Também em **Configurações**, dá para **iniciar o UnusHub com o Windows**
e, com isso ligado, deixá-lo na **bandeja do sistema**: ele começa só com o ícone
perto do relógio, fechar a janela só a esconde, e os avisos de bateria continuam chegando.
O menu pode ficar **em cima** (padrão) ou **à esquerda**, como barra lateral; à esquerda,
o alfinete deixa o menu sempre aberto ou recolhido (só ícones, abre ao passar o mouse).
No primeiro uso, o Início dá as boas-vindas e mostra os aparelhos
encontrados, com o botão para ativar o suporte de cada marca.

Ainda **não** faz: atualização de firmware, turbo e macros.

## Como rodar

Requer Node.js 20 ou mais novo.

```bash
npm install
npm start
```

O efeito no microfone da aba Sons precisa ser compilado uma vez (Visual Studio
Build Tools com C++ e o SDK do Windows):

```bash
native\audio-mix\compilar.cmd
```

Desde a 0.1.4 o UnusHub é distribuído com **instalador** (`UnusHub-Setup-<versão>.exe`
nas releases do GitHub). O app instalado avisa quando há uma versão nova e se
atualiza sozinho (**Configurações › Atualizações**), pelo `electron-updater`.

Para gerar o instalador (sai em `dist`, com o `latest.yml` e o `.blockmap`, que vão
junto na release):

```bash
npm run dist
```

O exe portátil (`npm run dist:portatil`) fica só para testes e não vai para as releases.

Feche outros apps que usem o mesmo aparelho antes de usar a aba correspondente: dois
apps disputando o mesmo dispositivo HID causam falhas de leitura.

## Arquitetura

- **Electron**. Por padrão, sem módulos nativos e sem DLLs: tudo o que dá para
  fazer com APIs da web e do Electron é feito assim. Veja a exceção em
  [Código nativo](#código-nativo).
- O processo principal (`src/main/`) cria a janela, libera o acesso HID para a
  página local e faz o que a web não alcança. Um arquivo por assunto:
  - `main.cjs`: janela, tema, bandeja, iniciar com o Windows e a partida do app;
  - `settings-store.cjs`: configurações gravadas e idioma em uso;
  - `permissions.cjs`: o que a página pode usar (HID, microfone, notificações);
  - `sounds.cjs` e `sound-hotkeys.cjs`: pasta dos sons e atalhos globais;
  - `mic-effect.cjs` e `audio-devices.cjs`: efeito no microfone e aparelhos de
    som do Windows, pelos programas de `native/audio-mix`;
  - `system-info.cjs`: bateria Bluetooth, versão USB e teclados, pelo PowerShell;
  - `app-updates.cjs` e `updates.cjs`: atualizações;
  - `preload.cjs`: os pedidos que a página pode fazer (`window.unihub`).
- A página (`src/renderer/`) usa APIs padrão:
  - **WebHID** para conversar com os dispositivos;
  - **Gamepad API** para o teste de botões.
- `core/hid-manager.js`: registro de dispositivos; trata conexão e desconexão.
- `core/command-queue.js`: fila por dispositivo, com confirmação e reenvio.
- `plugins/<tipo>/<marca>/`: o plugin da marca, só backend: `protocol.js` (bytes,
  testável), `session.js` (um dispositivo aberto) e o que se sabe dos modelos.
- `frontend/<tipo>/`: a tela, uma aba por tipo de aparelho.

Para adicionar um fabricante: [docs/como-adicionar-um-hub.md](docs/como-adicionar-um-hub.md).

## Código nativo

Uma DLL própria só entra quando o recurso não tem como ser feito com APIs da
web e do Electron (exemplo: somar sons ao microfone dentro do Windows). Nesse caso:

- **Pelo caminho que o Windows já oferece.** O componente é carregado por um
  mecanismo de extensão do próprio Windows, como os efeitos de áudio (APO) que o
  serviço de áudio carrega no microfone. Sem driver de kernel.
- **Sem desligar proteções.** Nada de modo de teste, desligar a verificação de
  assinatura ou a proteção do processo de áudio. Se o Windows recusar o
  componente, o recurso fica indisponível em vez de forçar.
- **Código próprio.** Escrito a partir da documentação e dos exemplos públicos
  da Microsoft, nunca copiado de apps de fabricantes.
- **Instalação reversível.** Quem instala é a pessoa, como administrador, e
  sabendo o que muda. A instalação guarda um backup do que alterou e há sempre
  um jeito de remover tudo e voltar ao estado anterior.
- **Pequeno e isolado.** A DLL faz só a parte que o app não consegue; o resto
  continua no app. Se a DLL não estiver instalada, o app funciona sem o recurso.

O que fica em `native/audio-mix` (compilado por `compilar.cmd`, só com DLLs do
próprio Windows, sem pacotes extras):

- `efeito/`: a DLL do efeito no microfone. Ao mudar a DLL, suba o número em
  `versao.txt`: o app compara com o instalado e oferece "Atualizar efeito".
- `ponte/`: `ponte.exe`, que manda o som do app para o efeito.
- `saidas/`: `saidas.exe`, que lista os aparelhos de som do Windows, troca o
  padrão, volume e mudo, e lê o estado do efeito em cada microfone.
- `instalar.ps1` e `remover.ps1`: instalam e removem o efeito, como administrador.
  Ficam em UTF-8 com BOM, senão o PowerShell 5 lê os acentos errado.

O efeito não funciona em microfone de fone Bluetooth (o Windows não roda efeitos
nele) nem em Windows ARM (a DLL é x64); nesses casos a aba Sons oferece o cabo virtual.

## Limitações conhecidas

- Dois controles idênticos aparecem com o mesmo nome. Para saber qual é qual,
  aperte um botão no controle: a entrada dele pisca por 1,5 s na lista.
- O dongle GameSir e o controle ligado nele viram uma entrada só. A regra usa
  a tabela de PIDs conhecidos em `plugins/gamepads/gamesir/names.js`; modelos novos
  precisam ser cadastrados lá.
- O layout dos perfis GameSir muda entre modelos. O mapeamento de botões só
  aparece para modelos confirmados (hoje, o Cyclone 2).

## Licença

MIT. Veja [LICENSE](LICENSE). Marcas citadas pertencem aos respectivos donos;
este projeto não é afiliado a nenhum fabricante.
