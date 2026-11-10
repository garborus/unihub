// Bloco de iluminação GameSir (slot 32). Funções puras: bytes <-> modelo.
// Formato documentado em docs/protocolos/gamesir.md ("Bloco de iluminação").

export const LIGHT_SLOT = 32;
export const LIGHT_BLOCK_SIZE = 635;
export const STORED_ANIMATIONS = 5;
export const EDITABLE_ANIMATIONS = 4;
export const MAX_KEYFRAMES = 8;
export const LED_COUNT = 5;
export const MAX_SPEED = 20;
export const STANDBY_OPTIONS = [0, 1, 5, 10, 20]; // minutos; 0 = desativado

const ANIMATION_SIZE = 124;
const ANIMATIONS_START = 1;
const EXTRA_START = ANIMATIONS_START + STORED_ANIMATIONS * ANIMATION_SIZE; // 621
const EFFECT_TYPE = 5;

/** Posição física de cada luz da interface no bloco de LEDs, por modelo. */
export const LED_LAYOUTS = {
  cyclone2: [
    { label: '1', led: 0, position: 'left' },
    { label: '2', led: 3, position: 'top' },
    { label: '3', led: 1, position: 'right' },
    { label: '4', led: 4, position: 'bottom' },
  ],
  // Modelo ainda não mapeado: mostra os 5 LEDs na ordem do bloco.
  generic: [0, 1, 2, 3, 4].map((led) => ({ label: String(led + 1), led, position: null })),
};

export function parseLightBlock(bytes) {
  if (bytes.length !== LIGHT_BLOCK_SIZE) throw new Error(`Bloco de luz com ${bytes.length} bytes (esperado ${LIGHT_BLOCK_SIZE})`);
  const animations = [];
  for (let a = 0; a < STORED_ANIMATIONS; a++) {
    const base = ANIMATIONS_START + a * ANIMATION_SIZE;
    const frames = [];
    for (let f = 0; f < MAX_KEYFRAMES; f++) {
      const leds = [];
      for (let l = 0; l < LED_COUNT; l++) {
        const at = base + 4 + f * LED_COUNT * 3 + l * 3;
        leds.push(toHexColor(bytes[at], bytes[at + 1], bytes[at + 2]));
      }
      frames.push(leds);
    }
    animations.push({
      keyFrames: clamp(bytes[base], 1, MAX_KEYFRAMES),
      effect: bytes[base + 1],
      speed: MAX_SPEED - clamp(bytes[base + 2], 0, MAX_SPEED),
      brightness: clamp(bytes[base + 3], 0, 100),
      frames,
    });
  }
  const x = EXTRA_START;
  return {
    activeAnimation: bytes[0] < EDITABLE_ANIMATIONS ? bytes[0] : 0,
    animations,
    audioReactive: (bytes[x] & 1) === 1,
    holdToWake: (bytes[x + 5] & 1) === 1,
    standbyMinutes: bytes[x + 6],
    // Campos que o UnusHub não edita, guardados como vieram.
    preserved: {
      audioByte: bytes[x],
      userEffectIndex: bytes[x + 1],
      profileLed: Array.from(bytes.slice(x + 2, x + 5)),
      wakeByte: bytes[x + 5],
      reserved: Array.from(bytes.slice(x + 7, LIGHT_BLOCK_SIZE)),
    },
  };
}

export function buildLightBlock(model) {
  const out = new Uint8Array(LIGHT_BLOCK_SIZE);
  out[0] = clamp(model.activeAnimation, 0, EDITABLE_ANIMATIONS - 1);
  model.animations.forEach((anim, a) => {
    const base = ANIMATIONS_START + a * ANIMATION_SIZE;
    out[base] = clamp(anim.keyFrames, 1, MAX_KEYFRAMES);
    out[base + 1] = anim.effect || EFFECT_TYPE;
    out[base + 2] = MAX_SPEED - clamp(anim.speed, 0, MAX_SPEED);
    out[base + 3] = clamp(anim.brightness, 0, 100);
    anim.frames.forEach((leds, f) => leds.forEach((color, l) => {
      const at = base + 4 + f * LED_COUNT * 3 + l * 3;
      out.set(fromHexColor(color), at);
    }));
  });
  const x = EXTRA_START;
  const p = model.preserved;
  out[x] = (p.audioByte & ~1) | (model.audioReactive ? 1 : 0);
  out[x + 1] = p.userEffectIndex;
  out.set(p.profileLed, x + 2);
  out[x + 5] = (p.wakeByte & ~1) | (model.holdToWake ? 1 : 0);
  out[x + 6] = clamp(model.standbyMinutes, 0, 255);
  out.set(p.reserved, x + 7);
  return out;
}

/** Menor trecho que mudou entre dois blocos, ou null se forem iguais. */
export function changedRange(before, after) {
  let start = -1;
  let end = -1;
  for (let i = 0; i < after.length; i++) {
    if (before[i] !== after[i]) {
      if (start === -1) start = i;
      end = i;
    }
  }
  return start === -1 ? null : { start, end };
}

// --- Predefinições -----------------------------------------------------------
// Criadas para o UnusHub. Cada uma recebe o layout de luzes do modelo e devolve
// velocidade + quadros com as cores de cada luz (na ordem do layout).

export const PRESETS = [
  { id: 'flow', label: 'Fluxo', speed: 12, frames: (n) => rotate(['#00e5ff', '#0050ff', '#000000', '#0050ff'], n) },
  { id: 'rainbow', label: 'Arco-íris', speed: 14, frames: (n) =>
    ['#ff0000', '#ff8000', '#ffff00', '#00ff00', '#0080ff', '#8000ff'].map((_, i, hues) =>
      Array.from({ length: n }, (_, l) => hues[(i + l) % hues.length])) },
  { id: 'pulse', label: 'Pulso', speed: 10, frames: (n) => [Array(n).fill('#ffffff'), Array(n).fill('#000000')] },
  { id: 'balance', label: 'Equilíbrio', speed: 4, frames: (n) => [
    Array.from({ length: n }, (_, l) => (l % 2 ? '#ff6a00' : '#00b4ff')),
    Array.from({ length: n }, (_, l) => (l % 2 ? '#00b4ff' : '#ff6a00')),
  ] },
  { id: 'alarm', label: 'Alarme', speed: 18, frames: (n) => [Array(n).fill('#ff0000'), Array(n).fill('#000000')] },
  { id: 'off', label: 'Desativado', speed: 0, frames: (n) => [Array(n).fill('#000000')] },
];

/** Gira uma lista de cores para criar um quadro por posição. */
function rotate(colors, n) {
  return colors.map((_, i) => Array.from({ length: n }, (_, l) => colors[(l + i) % colors.length]));
}

/** Aplica uma predefinição na animação, usando as luzes do layout. */
export function applyPreset(anim, preset, layout) {
  const frames = preset.frames(layout.length).slice(0, MAX_KEYFRAMES);
  anim.speed = preset.speed;
  anim.keyFrames = frames.length;
  for (let f = 0; f < MAX_KEYFRAMES; f++) {
    const colors = frames[f];
    layout.forEach((light, i) => {
      anim.frames[f][light.led] = colors ? colors[i] : '#000000';
    });
  }
}

/** Move um quadro-chave de posição (arrastar para reordenar). */
export function moveFrame(anim, from, to) {
  if (from === to || from >= anim.keyFrames || to >= anim.keyFrames) return;
  const [frame] = anim.frames.splice(from, 1);
  anim.frames.splice(to, 0, frame);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(n) || 0)));
}

function toHexColor(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function fromHexColor(color) {
  const v = parseInt(String(color).replace('#', ''), 16) || 0;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}
