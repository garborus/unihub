// Escolha das saídas de som da aba Sons, sem nada de tela (dá para testar).
//
// Para o som chegar a um app de chamada como se viesse do microfone, o app
// toca numa saída de um cabo de áudio virtual (um driver que a pessoa instala,
// como VB-CABLE ou VoiceMeeter). O que entra na saída do cabo sai na entrada
// dele, e essa entrada é escolhida como microfone no Discord, no jogo etc.

import { isVirtualDevice } from '../../shared/audio-labels.js';

// Reexportado: quem escolhe aparelhos na aba Sons importa tudo daqui.
export { isVirtualDevice };

// Nomes de saídas de cabos virtuais conhecidos.
const VIRTUAL_OUTPUT = /\bcable\b|virtual|voicemeeter|steam streaming microphone/i;

/** A saída parece ser de um cabo de áudio virtual? */
export function isVirtualOutput(label) {
  return VIRTUAL_OUTPUT.test(label || '');
}

/** Aparelhos de verdade de um tipo, sem os virtuais (para "onde você ouve" e microfones). */
export function physicalDevices(devices, kind) {
  return realDevices(devices, kind).filter((d) => !isVirtualDevice(d.label));
}

/** Saídas reais da lista (sem as entradas "Padrão" e "Comunicação" do Chromium). */
export function realDevices(devices, kind) {
  return devices.filter((d) => d.kind === kind && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

/**
 * Saída do microfone virtual: a guardada, se ainda existe; senão a primeira que
 * parece um cabo virtual; senão nenhuma (a pessoa escolhe).
 */
export function pickMicOutput(devices, savedId) {
  const outputs = realDevices(devices, 'audiooutput');
  return outputs.find((d) => d.deviceId === savedId)
    || outputs.find((d) => isVirtualOutput(d.label))
    || null;
}
