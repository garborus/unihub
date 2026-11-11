// Preferências da aba Sons, guardadas no navegador do app (localStorage).

const STORAGE_KEY = 'unihub.sounds';

// micMode: como o som chega à chamada. 'effect' (padrão) = efeito de áudio do
// UnusHub no microfone (native/audio-mix); 'cable' = cabo de áudio virtual, para
// quem não pode instalar o efeito ou usa um app que pega o microfone direto.
// volumeEar / volumeMic: volume dos sons no fone e no microfone (0 a 100).
const DEFAULT_PREFS = { listen: '', micOut: '', micIn: '', mixVoice: false, volumeEar: 80, volumeMic: 80, micMode: 'effect', effectMic: '' };

export function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    // Antes havia um volume só: vale para os dois.
    if (typeof saved.volume === 'number') {
      saved.volumeEar ??= saved.volume;
      saved.volumeMic ??= saved.volume;
      delete saved.volume;
    }
    return { ...DEFAULT_PREFS, ...saved };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Nome da preferência de volume: 'ear' (fone) ou 'mic' (microfone). */
export const volumeKey = (kind) => (kind === 'ear' ? 'volumeEar' : 'volumeMic');

export function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* sem armazenamento */ }
}
