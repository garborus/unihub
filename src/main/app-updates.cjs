// Atualizações do app.
//
// Ver updates.cjs. Três jeitos de rodar:
// - instalado (instalador NSIS): electron-updater baixa o instalador novo das
//   releases do GitHub (confere o SHA-512 do latest.yml) e instala ao reiniciar;
// - exe portátil: informa o próprio caminho em PORTABLE_EXECUTABLE_FILE, e o app
//   baixa o exe novo e troca um pelo outro;
// - pelo código (desenvolvimento): só abre a página da release.

const { app, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const updates = require('./updates.cjs');

// As versões 0.x saem todas como pre-release: entram sempre.
const withPrerelease = () => true;

const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
const installedApp = () => app.isPackaged && !portableExe();
let downloadedUpdate = null; // { version, file } (portátil) ou { version, installer: true }

let autoUpdater = null;
function getAutoUpdater() {
  if (!autoUpdater) {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false; // só baixa quando a pessoa clica em "Atualizar"
    autoUpdater.autoInstallOnAppQuit = true; // baixada e o app fechou: instala em silêncio
    // A versão é sempre escolhida pelo app (a mais nova, ou uma que a pessoa
    // escolheu, mesmo mais antiga): o feed aponta para a pasta daquela versão.
    autoUpdater.allowDowngrade = true;
    autoUpdater.logger = null;
  }
  return autoUpdater;
}

/** ctx.markQuitting(): avisa que o app vai fechar de verdade (não só para a bandeja). */
function register(ctx) {
  ipcMain.handle('update:check', async () => {
    const current = app.getVersion();
    try {
      const res = await fetch(`https://api.github.com/repos/${updates.REPO}/releases?per_page=20`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UnusHub-updater' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return { current, error: `GitHub respondeu ${res.status}` };
      const releases = await res.json();
      const prerelease = withPrerelease();
      const latest = updates.pickLatest(releases, { prerelease });
      const newer = !!latest && updates.compareVersions(latest.version, current) > 0;
      const installed = installedApp();
      return {
        current, latest, newer,
        // Versões que a pessoa pode escolher instalar (só no app instalado).
        versions: installed ? updates.installableVersions(releases, { prerelease }) : [],
        canInstall: newer && (installed ? !!latest.installer : !!latest.asset && !!portableExe()),
        // Tamanho do que vai ser baixado (para o botão "Atualizar (… MB)").
        size: (installed ? latest?.installer?.size : latest?.asset?.size) || 0,
        downloaded: downloadedUpdate?.version === latest?.version,
      };
    } catch (err) {
      return { current, error: err.name === 'TimeoutError' ? 'sem resposta do GitHub' : 'sem conexão com o GitHub' };
    }
  });

  // Baixa o exe novo para a pasta do exe atual, conferindo tamanho e SHA-256.
  // Versão instalada: o electron-updater baixa o instalador novo e confere o SHA-512.
  // `wanted`: versão escolhida (ex.: uma mais antiga); sem ela, a mais nova.
  async function downloadInstalledUpdate(event, wanted) {
    const updater = getAutoUpdater();
    try {
      let target = wanted;
      if (!target) {
        const res = await fetch(`https://api.github.com/repos/${updates.REPO}/releases?per_page=20`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UnusHub-updater' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`);
        target = updates.pickLatest(await res.json(), { prerelease: withPrerelease() })?.version;
        if (!target || updates.compareVersions(target, app.getVersion()) <= 0) {
          return { ok: false, message: 'Nenhuma versão nova para baixar.' };
        }
      }
      const feed = updates.releaseFilesUrl(target);
      if (!feed || updates.compareVersions(target, app.getVersion()) === 0) {
        return { ok: false, message: 'Essa já é a versão em uso.' };
      }
      // O latest.yml de cada release aponta para o instalador dela (com SHA-512).
      updater.setFeedURL({ provider: 'generic', url: feed });
      const check = await updater.checkForUpdates();
      const version = check?.updateInfo?.version;
      if (!version || updates.compareVersions(version, target) !== 0) {
        return { ok: false, message: 'Não foi possível achar essa versão.' };
      }
      const onProgress = (p) => event.sender.send('update:progress', { received: p.transferred, total: p.total });
      updater.on('download-progress', onProgress);
      try {
        await updater.downloadUpdate();
      } finally {
        updater.off('download-progress', onProgress);
      }
      downloadedUpdate = { version, installer: true };
      return { ok: true, version, verified: true };
    } catch (err) {
      return { ok: false, message: `Não foi possível baixar: ${String(err?.message || err).split('\n')[0]}.` };
    }
  }

  ipcMain.handle('update:download', async (event, wanted) => {
    if (wanted != null && !updates.parseVersion(wanted)) return { ok: false, message: 'Versão inválida.' };
    if (installedApp()) return downloadInstalledUpdate(event, wanted || null);
    if (wanted) return { ok: false, message: 'Escolher a versão só funciona no app instalado.' };
    const exe = portableExe();
    if (!exe) return { ok: false, message: 'Rodando pelo código: baixe a versão nova na página.' };
    const res = await fetch(`https://api.github.com/repos/${updates.REPO}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UnusHub-updater' },
    }).catch(() => null);
    const latest = res?.ok ? updates.pickLatest(await res.json(), { prerelease: withPrerelease() }) : null;
    if (!latest?.asset || updates.compareVersions(latest.version, app.getVersion()) <= 0) {
      return { ok: false, message: 'Nenhuma versão nova para baixar.' };
    }
    const target = path.join(path.dirname(exe), latest.asset.name);
    if (path.resolve(target).toLowerCase() === path.resolve(exe).toLowerCase()) {
      return { ok: false, message: 'O arquivo novo tem o mesmo nome do atual.' };
    }
    const part = `${target}.download`;
    try {
      const file = await fetch(latest.asset.url, { headers: { 'User-Agent': 'UnusHub-updater' } });
      if (!file.ok || !file.body) throw new Error(`download respondeu ${file.status}`);
      const total = Number(file.headers.get('content-length')) || latest.asset.size || 0;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let received = 0;
      let lastSent = 0;
      for await (const chunk of file.body) {
        hash.update(chunk);
        received += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - lastSent > 150) {
          lastSent = Date.now();
          event.sender.send('update:progress', { received, total });
        }
      }
      await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
      if (latest.asset.size && received !== latest.asset.size) throw new Error('arquivo incompleto');
      const digest = hash.digest('hex');
      if (latest.asset.sha256 && digest !== latest.asset.sha256) throw new Error('o arquivo baixado não confere (SHA-256)');
      fs.renameSync(part, target);
      downloadedUpdate = { version: latest.version, file: target };
      return { ok: true, version: latest.version, verified: !!latest.asset.sha256 };
    } catch (err) {
      fs.rmSync(part, { force: true });
      return { ok: false, message: `Não foi possível baixar: ${err.message}.` };
    }
  });

  // Fecha o app; um script espera ele sair, apaga o exe antigo e abre o novo.
  ipcMain.handle('update:install', () => {
    // Instalado: fecha e roda o instalador novo em silêncio, que abre o app no fim.
    if (installedApp()) {
      if (!downloadedUpdate?.installer) return { ok: false };
      ctx.markQuitting();
      getAutoUpdater().quitAndInstall(true, true);
      return { ok: true };
    }
    const exe = portableExe();
    if (!exe || !downloadedUpdate || !fs.existsSync(downloadedUpdate.file)) return { ok: false };
    const script = path.join(app.getPath('temp'), `unihub-atualizar-${Date.now()}.cmd`);
    fs.writeFileSync(script, updates.swapScript(exe, downloadedUpdate.file), 'utf8'); // o script troca o console para UTF-8
    spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    ctx.markQuitting();
    app.quit();
    return { ok: true };
  });

  ipcMain.handle('update:open-page', (_event, url) => {
    // Só páginas de release deste repositório.
    if (updates.isReleaseUrl(url) || updates.isReleaseUrl(`${url}/`)) shell.openExternal(url);
  });
}

module.exports = { register };
