// Como achar fones e headsets de qualquer marca, sem protocolo próprio:
//
// - pelo HID: headsets USB (com fio ou com dongle) costumam ter a coleção de
//   telefonia (Usage Page 0x0B), usada para os botões de atender e mudo;
// - pela lista de som: o Chromium dá a cada saída de som um nome como
//   "Fones de ouvido (Nome do fone) (Bluetooth)" ou "... (046d:0a87)". É o
//   único jeito de ver fones Bluetooth, que não aparecem no HID.
//
// Funções puras: recebem as listas e devolvem os fones, para dar para testar.

export const TELEPHONY_USAGE_PAGE = 0x0b;

/** Interface HID de headset: tem a coleção de telefonia. */
export function isHeadsetInterface(device) {
  return device.collections.some((c) => c.usagePage === TELEPHONY_USAGE_PAGE);
}

// Prefixos que o Chromium põe nas entradas "Padrão" e "Comunicação".
const ROLE_PREFIX = /^(default|communications|padrão|comunicação|comunicações)\s+-\s+/i;
const SUFFIX = /\s+\((bluetooth|[0-9a-f]{4}:[0-9a-f]{4})\)\s*$/i;

/**
 * "Fones de ouvido (WH-1000XM4) (Bluetooth)" → { endpoint: "Fones de ouvido",
 * name: "WH-1000XM4", transport: "bluetooth", vidPid: null }.
 */
export function parseSoundLabel(label) {
  let text = (label || '').trim().replace(ROLE_PREFIX, '');
  let transport = 'other';
  let vidPid = null;
  const suffix = SUFFIX.exec(text);
  if (suffix) {
    text = text.slice(0, suffix.index);
    if (/bluetooth/i.test(suffix[1])) transport = 'bluetooth';
    else {
      transport = 'usb';
      vidPid = suffix[1].toLowerCase();
    }
  }
  const inner = /^(.*?)\s*\((.*)\)$/.exec(text);
  const endpoint = inner ? inner[1] : text;
  const name = cleanName(inner ? inner[2] : text);
  return { endpoint, name, transport, vidPid };
}

/**
 * Tira o que o Windows acrescenta ao nome: o perfil Bluetooth ("Hands-Free",
 * "Stereo") e o contador de nomes repetidos ("2- MCHOSE V9 PRO", quando o
 * mesmo fone também aparece pelo dongle).
 */
export function cleanName(name) {
  return name.replace(/^\d+-\s*/, '').replace(/\s+(hands-free( ag)?( audio)?|stereo)$/i, '').trim();
}

// Palavras que indicam fone (no nome da saída de som ou do aparelho).
const HEADSET_WORDS = /head(phone|set)s?|fones?\b|fone de ouvido|earphones?|earbuds?|\bbuds\b|airpods|auriculares?|casque|kopfhörer|écouteurs/i;

export function isHeadsetSound({ endpoint, name }) {
  return HEADSET_WORDS.test(endpoint) || HEADSET_WORDS.test(name);
}

/**
 * Fones na lista de som do sistema, um por aparelho (sem repetir o perfil
 * de chamada do mesmo fone Bluetooth).
 * @param {MediaDeviceInfo[]} mediaDevices
 * @returns {{ key: string, name: string, transport: string, vidPid: string|null }[]}
 */
export function soundHeadsets(mediaDevices) {
  const found = new Map();
  for (const d of mediaDevices) {
    if (d.kind !== 'audiooutput' || d.deviceId === 'default' || d.deviceId === 'communications') continue;
    const sound = parseSoundLabel(d.label);
    if (!sound.name || !isHeadsetSound(sound)) continue;
    const key = `${sound.transport}:${sound.vidPid || sound.name.toLowerCase()}`;
    if (!found.has(key)) found.set(key, { key, name: sound.name, transport: sound.transport, vidPid: sound.vidPid });
  }
  return [...found.values()];
}

const hex4 = (n) => n.toString(16).padStart(4, '0');
export const vidPidOf = (device) => `${hex4(device.vendorId)}:${hex4(device.productId)}`;

/**
 * Fones sem opções próprias no UnusHub (outras marcas), juntando HID e som.
 * @param {object} o
 * @param {HIDDevice[]} o.hid           interfaces HID de headset de outras marcas
 * @param {ReturnType<typeof soundHeadsets>} o.sound
 * @param {(sound: object) => boolean} o.claimed  fones que outra parte já mostra (ex.: MCHOSE)
 */
export function genericHeadsets({ hid, sound, claimed }) {
  const entries = hid.map((device) => ({
    key: `hid:${vidPidOf(device)}:${device.productName}`,
    device,
    name: device.productName || 'Headset',
    transport: 'usb',
    vidPid: vidPidOf(device),
  }));
  const hidCodes = new Set(entries.map((e) => e.vidPid));
  for (const s of sound) {
    if (claimed(s)) continue;
    if (s.vidPid && hidCodes.has(s.vidPid)) continue; // o mesmo fone já veio pelo HID
    entries.push({ key: `sound:${s.key}`, device: null, ...s });
  }
  return entries;
}

/**
 * Bateria de um fone Bluetooth, pelo nome. O Windows dá o nome do perfil de
 * chamada ("MCHOSE V9 PRO Hands-Free AG"); o som usa só "MCHOSE V9 PRO".
 * @param {{name: string, percent: number}[]} batteries
 */
export function bluetoothBatteryFor(batteries, name) {
  const want = cleanName(name).toLowerCase();
  const hit = batteries.find((b) => cleanName(b.name).toLowerCase() === want);
  return hit && Number.isFinite(hit.percent) ? Math.max(0, Math.min(100, hit.percent)) : null;
}

/**
 * Reconhece o som (saída e microfone) de um fone na lista do sistema: pelo
 * VID:PID quando é USB, pelo nome quando é Bluetooth.
 * @param {{name: string, transport: string, vidPid: string|null}} headset
 */
export function soundMatcherFor(headset) {
  const want = headset.name.toLowerCase();
  return (label) => {
    const s = parseSoundLabel(label);
    if (headset.vidPid) return s.vidPid === headset.vidPid;
    return s.transport === headset.transport && s.name.toLowerCase() === want;
  };
}

export const CONNECTION_TEXT = { bluetooth: 'via Bluetooth', usb: 'via USB', other: null };
