// Atalhos de teclado dos sons: transforma a tecla apertada no formato de atalho
// do Electron ("Ctrl+Shift+A", "F9", "num5") e mostra o atalho para a pessoa.

const NAMED = {
  Space: 'Space', Enter: 'Enter', Tab: 'Tab', Escape: 'Esc', // Esc só com modificador (sozinho cancela a gravação) Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.',
  Slash: '/', Backslash: '\\', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  MediaPlayPause: 'MediaPlayPause', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', MediaStop: 'MediaStop',
};

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

/** Tecla principal do evento no formato do Electron, ou '' (só modificador, ou tecla sem suporte). */
export function keyOf(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^F(\d{1,2})$/.exec(code)) && +m[1] >= 1 && +m[1] <= 24) return `F${m[1]}`;
  if ((m = /^Numpad(\d)$/.exec(code))) return `num${m[1]}`;
  return NAMED[code] || '';
}

/**
 * Atalho a partir de um KeyboardEvent ({ code, ctrlKey, altKey, shiftKey, metaKey }).
 * Devolve '' enquanto só modificadores estão apertados.
 */
export function acceleratorFromEvent(e) {
  if (MODIFIER_CODES.test(e.code)) return '';
  const key = keyOf(e.code);
  if (!key) return '';
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  return [...mods, key].join('+');
}

// Um atalho tem de 1 a 3 teclas: a principal e até dois modificadores (ex.: Shift+F1, Ctrl+Alt+K).
export const MAX_HOTKEY_KEYS = 3;

/** Id do atalho "parar todos os sons" (o * não existe em nome de arquivo, então não é de um som). */
export const STOP_HOTKEY_ID = '*parar';

/** Quantas teclas o atalho usa ("Ctrl+Shift+A" = 3). */
export function hotkeyKeyCount(accelerator) {
  return accelerator ? accelerator.split('+').length : 0;
}

/** Atalho sem modificador numa tecla de digitar (letra, número, espaço, pontuação). */
export function isTypingKey(accelerator) {
  return !accelerator.includes('+') && /^([A-Z0-9]|Space|[-=[\];',./\\`])$/.test(accelerator);
}

const LABELS = { numadd: 'Num +', numsub: 'Num -', nummult: 'Num *', numdiv: 'Num /', numdec: 'Num ,', Super: 'Win', Space: 'Espaço',
  Up: '↑', Down: '↓', Left: '←', Right: '→', MediaPlayPause: 'Play/Pause', MediaNextTrack: 'Próxima', MediaPreviousTrack: 'Anterior', MediaStop: 'Stop' };

/** Como o atalho aparece na tela: "Ctrl+Shift+A", "Num 5", "F9". */
export function acceleratorLabel(accelerator) {
  return accelerator.split('+').map((part) => {
    if (LABELS[part]) return LABELS[part];
    const m = /^num(\d)$/.exec(part);
    return m ? `Num ${m[1]}` : part;
  }).join('+');
}
