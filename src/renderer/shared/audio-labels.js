// Nomes de aparelhos de som: como mostrar na tela e quais são virtuais.
// Usado pela aba Sons e pela tela de áudio dos headsets.

/** Nome sem o "(VID:PID)" ou "(Bluetooth)" que o Chromium põe no fim. */
export function friendlyLabel(label) {
  return label.replace(/\s*\(([0-9a-f]{4}:[0-9a-f]{4}|bluetooth)\)\s*$/i, '');
}

// Aparelhos de som virtuais (cabos e os da Steam): não são onde a pessoa ouve nem
// o microfone dela, então ficam fora das listas de fone e de microfone.
const VIRTUAL_DEVICE = /\bcable\b|virtual|voicemeeter|steam streaming/i;

/** O aparelho (saída ou entrada) é virtual? */
export function isVirtualDevice(label) {
  return VIRTUAL_DEVICE.test(label || '');
}
