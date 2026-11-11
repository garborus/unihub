// Permissões da página do app: WebHID, notificações, microfone e escolha de saída
// de som. Só a página local (file:) recebe; nenhuma origem remota.

const { session } = require('electron');

// A página do app é carregada do disco; nenhuma origem remota recebe HID.
function isAppOrigin(origin) {
  return typeof origin === 'string' && origin.startsWith('file:');
}

function isAppFrame(details) {
  return !!details && (isAppOrigin(details.origin) || isAppOrigin(details.requestingUrl));
}

function setupHidPermissions() {
  const ses = session.defaultSession;

  // Permite que navigator.hid.getDevices() devolva os dispositivos sem a
  // janela de seleção do Chromium. Só a página local do app recebe acesso.
  // HID para falar com os aparelhos; notificações para o aviso de bateria baixa;
  // microfone e escolha de saída de som para o teste e o retorno de voz do headset.
  const ALLOWED = new Set(['hid', 'notifications', 'media', 'speaker-selection']);
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    return ALLOWED.has(permission) && (isAppOrigin(requestingOrigin) || isAppFrame(details));
  });
  // Pedido de mídia: só áudio (nunca câmera), só da página do app.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const appPage = isAppOrigin(details?.requestingUrl) || isAppOrigin(wc.getURL());
    if (permission === 'media') {
      const types = details?.mediaTypes || [];
      return callback(appPage && types.length > 0 && types.every((t) => t === 'audio'));
    }
    callback(appPage && ALLOWED.has(permission));
  });
  ses.setDevicePermissionHandler((details) => {
    return details.deviceType === 'hid' && isAppFrame(details);
  });

  // requestDevice() (botão "Procurar dispositivos") escolhe o primeiro
  // dispositivo da lista filtrada. Os demais já chegam via permissão acima.
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const first = details.deviceList[0];
    callback(first ? first.deviceId : '');
  });
}

module.exports = { setupHidPermissions };
