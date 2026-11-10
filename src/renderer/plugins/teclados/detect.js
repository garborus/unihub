// Identificação de teclados de qualquer marca pelas interfaces HID.
//
// Todo teclado tem uma interface "Keyboard" (página Generic Desktop, uso 0x06).
// O Chromium mostra essa interface, mas não deixa ler as teclas por ela (o teste
// de teclas usa os eventos de teclado da página). Controles e receptores de
// mouse também costumam ter uma interface de teclado (para macros e atalhos),
// então o aparelho é agrupado pelo VID:PID e:
// - controle (interface de jogo, ou "controller" no nome) nunca é teclado;
// - com "keyboard"/"teclado" no nome, é teclado;
// - sem nome que diga, só é teclado se nenhuma interface for de mouse;
// - teclados conhecidos (AULA série F) entram sempre, no cabo ou pelo receptor.
//   Com o cabo ligado, o receptor do mesmo teclado fica de fora (o teclado usa
//   o cabo), como o dongle dos headsets.

import { isAulaWired, isAulaReceiver } from './aula/devices.js';

const GENERIC_DESKTOP = 0x01;
const MOUSE = 0x02;
const KEYBOARD = 0x06;
const GAME_USAGES = [0x04, 0x05, 0x08]; // joystick, game pad, multi-axis

const KEYBOARD_NAME = /keyboard|teclado|keypad|\bkb\b/i;
const GAMEPAD_NAME = /controller|gamepad|joystick|controle/i;
const WIRELESS_NAME = /receiver|receptor|dongle|wireless|sem fio|2\.4\s*g|\brf\b/i;

const has = (device, usage) => device.collections.some((c) => c.usagePage === GENERIC_DESKTOP && c.usage === usage);

export const isKeyboardInterface = (device) => has(device, KEYBOARD);
const isMouseInterface = (device) => has(device, MOUSE);
const isGameInterface = (device) => GAME_USAGES.some((u) => has(device, u));

/** Interfaces que o plugin recebe: teclado e mouse (o mouse ajuda a separar receptores de mouse). */
export function isKeyboardOrMouse(device) {
  return (isKeyboardInterface(device) || isMouseInterface(device)) && !GAMEPAD_NAME.test(device.productName || '');
}

export const KEYBOARD_FILTERS = [{ usagePage: GENERIC_DESKTOP, usage: KEYBOARD }];

const hex4 = (n) => n.toString(16).padStart(4, '0');

/** Vendor IDs USB públicos de fabricantes de teclado (e de chips usados por várias marcas). */
const BRANDS = {
  0x046d: 'Logitech',
  0x1532: 'Razer',
  0x1b1c: 'Corsair',
  0x1038: 'SteelSeries',
  0x0951: 'HyperX',
  0x03f0: 'HP / HyperX',
  0x3434: 'Keychron',
  0x0b05: 'ASUS',
  0x045e: 'Microsoft',
  0x31e3: 'Wooting',
  0x1e7d: 'ROCCAT',
  0x04f2: 'Chicony',
  0x413c: 'Dell',
  0x17ef: 'Lenovo',
};
const CHIP_MAKERS = {
  0x258a: 'SINO WEALTH',
  0x0c45: 'SONiX',
  0x04d9: 'Holtek',
  0x05ac: 'Apple',
};

/** Fabricante pelo VID, ou null. Fabricante de chip vem com o aviso. */
export function brandOf(vendorId) {
  if (BRANDS[vendorId]) return BRANDS[vendorId];
  if (CHIP_MAKERS[vendorId]) return `${CHIP_MAKERS[vendorId]} (fabricante do chip, usado por várias marcas)`;
  return null;
}

// Teclados virtuais do Windows e do notebook, que não são um teclado de verdade:
// - PID 0000: aparelho criado pelo próprio Windows (ex.: 045E:0000, teclas de
//   atalho e botões do notebook convertidos em teclado);
// - VID 8087 (Intel): hub de sensores e filtro de teclas de atalho do notebook.
//   A Intel não faz teclados.
// O teclado do notebook de verdade vem da lista do Windows ("Teclado do notebook").
const VIRTUAL_VENDORS = new Set([0x8087]);

/** Interface de teclado que é virtual (Windows, Intel), e não um teclado. */
export function isVirtualKeyboard(device) {
  return device.productId === 0 || VIRTUAL_VENDORS.has(device.vendorId);
}

/**
 * Teclados conectados, um por VID:PID.
 * `brand` é 'aula' para os AULA série F (o nome final vem do modelo escolhido).
 * @returns {{ id: string, vidPid: string, name: string, connection: string|null, brand: string|null, devices: HIDDevice[] }[]}
 */
export function keyboardGroups(devices) {
  const groups = new Map();
  for (const d of devices) {
    const vidPid = `${hex4(d.vendorId)}:${hex4(d.productId)}`;
    if (!groups.has(vidPid)) groups.set(vidPid, []);
    groups.get(vidPid).push(d);
  }
  const result = [];
  const aulaWired = devices.some(isAulaWired);
  for (const [vidPid, list] of groups) {
    if (isAulaWired(list[0]) || isAulaReceiver(list[0])) {
      if (isAulaReceiver(list[0]) && aulaWired) continue;
      result.push({
        id: vidPid,
        vidPid,
        name: (list.find((d) => d.productName)?.productName || 'Teclado').trim(),
        connection: isAulaWired(list[0]) ? 'via cabo' : 'via dongle',
        brand: 'aula',
        devices: list,
      });
      continue;
    }
    if (!list.some(isKeyboardInterface)) continue;
    if (isVirtualKeyboard(list[0])) continue;
    const names = list.map((d) => (d.productName || '').trim()).filter(Boolean);
    if (list.some(isGameInterface) || names.some((n) => GAMEPAD_NAME.test(n))) continue;
    const named = names.some((n) => KEYBOARD_NAME.test(n));
    if (!named && list.some(isMouseInterface)) continue;
    const name = names.find((n) => KEYBOARD_NAME.test(n)) || names[0] || 'Teclado';
    result.push({
      id: vidPid,
      vidPid,
      name,
      connection: names.some((n) => WIRELESS_NAME.test(n)) ? 'via dongle' : null,
      brand: null,
      devices: list,
    });
  }
  return result;
}

// --- Teclados que só o Windows mostra -------------------------------------------
// O processo principal lista os teclados do Windows ({ id, name, chain }). Daqui
// saem duas coisas: quais teclados do WebHID são Bluetooth (com o nome do
// aparelho), e os teclados que o WebHID não mostra: o do notebook (PS/2 ou
// interno) e Bluetooth fora do WebHID. Teclado USB vem sempre do WebHID (lá dá
// para separar controles e receptores de mouse, que também têm "teclado").

const BT_SERVICE = /\{0000(1124|1812)-/i; // HID por Bluetooth clássico e por Bluetooth LE

/** Tipo de ligação, VID:PID e nome de um teclado da lista do Windows. */
export function classifySystemKeyboard(k) {
  const id = k.id || '';
  let bus = 'other';
  if (BT_SERVICE.test(id)) bus = 'bluetooth';
  else if (/^ACPI\\/i.test(id) || /^HID\\(VEN_|CONVERTEDDEVICE)/i.test(id)) bus = 'internal';
  else if (/^HID\\VID_/i.test(id)) bus = 'usb';
  // USB: VID_046D&PID_C52B; Bluetooth: VID&0002046D_PID&B342 (os 4 últimos dígitos são o VID).
  const m = /VID[_&]([0-9A-F]{4,8})[_&]PID[_&]([0-9A-F]{4})/i.exec(id);
  const vidPid = m ? `${m[1].slice(-4)}:${m[2]}`.toLowerCase() : null;
  const device = (k.chain || []).find((c) => /^BTH(ENUM|LE)\\DEV_/i.test(c.id || ''));
  const name = bus === 'bluetooth' ? (device?.name || null) : bus === 'internal' ? 'Teclado do notebook' : null;
  return { id, bus, vidPid, name };
}

/**
 * @param {{id: string, name?: string, chain?: object[]}[]} system  lista do Windows
 * @param {Set<string>} hidVidPids  VID:PID de todas as interfaces HID que o plugin recebeu
 * @returns {{ bluetooth: Map<string, string|null>, extra: object[] }}
 *   bluetooth: VID:PID -> nome, dos teclados do WebHID que são Bluetooth;
 *   extra: teclados que o WebHID não mostra (mesmo formato de keyboardGroups).
 */
export function systemKeyboards(system, hidVidPids) {
  const bluetooth = new Map();
  const extra = new Map(); // um por aparelho (o Windows lista uma entrada por coleção)
  for (const raw of system) {
    const k = classifySystemKeyboard(raw);
    if (k.bus === 'bluetooth' && k.vidPid && hidVidPids.has(k.vidPid)) {
      if (!bluetooth.get(k.vidPid)) bluetooth.set(k.vidPid, k.name);
      continue;
    }
    if (k.bus !== 'internal' && k.bus !== 'bluetooth') continue;
    const key = `${k.bus}:${k.vidPid || k.name || k.id}`;
    if (extra.has(key)) continue;
    extra.set(key, {
      id: `sys:${key}`,
      vidPid: k.vidPid,
      name: k.name || 'Teclado Bluetooth',
      connection: k.bus === 'bluetooth' ? 'via Bluetooth' : 'integrado',
      brand: null,
      devices: [],
    });
  }
  return { bluetooth, extra: [...extra.values()] };
}
