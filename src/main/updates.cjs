// Atualizações pelas releases do GitHub.
//
// Desde a 0.1.4 o UnusHub tem instalador, e a versão instalada se atualiza pelo
// electron-updater (main.cjs). O exe portátil continua: ele consulta as releases,
// baixa o exe novo para a pasta do exe atual e, ao reiniciar, troca um pelo outro.
//
// Só lógica pura aqui (dá para testar); a rede e os arquivos ficam no main.cjs.

const REPO = 'garborus/unihub';
const PORTABLE_ASSET = /-portable\.exe$/i;
const INSTALLER_ASSET = /-Setup-[^/]*\.exe$/i;

/** "v0.2.0-beta.1" -> { major, minor, patch, pre } ou null. */
function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

/** Compara como semver: negativo se a < b. Versão sem sufixo vale mais que com sufixo. */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre.localeCompare(y.pre, undefined, { numeric: true });
}

/**
 * Escolhe a release mais nova (sem rascunhos) a partir da resposta da API.
 * Devolve { version, notes, page, asset } — asset é o exe portátil, ou null se a
 * release não tiver um (ex.: a 1.0, que vem com instalador).
 */
function pickLatest(releases) {
  const candidates = (Array.isArray(releases) ? releases : [])
    .filter((r) => r && !r.draft && parseVersion(r.tag_name))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const r = candidates[0];
  if (!r) return null;
  const exe = (r.assets || []).find((a) => PORTABLE_ASSET.test(a.name || ''));
  const setup = (r.assets || []).find((a) => INSTALLER_ASSET.test(a.name || ''));
  const downloadPrefix = `https://github.com/${REPO}/releases/download/`;
  return {
    version: String(r.tag_name).replace(/^v/, ''),
    notes: String(r.body || '').slice(0, 2000),
    page: String(r.html_url || `https://github.com/${REPO}/releases`),
    // Instalador da versão (a versão instalada se atualiza por ele): só nome e tamanho.
    installer: setup ? { name: setup.name, size: setup.size } : null,
    asset: exe && String(exe.browser_download_url || '').startsWith(downloadPrefix)
      ? {
        name: exe.name,
        size: exe.size,
        url: exe.browser_download_url,
        // A API do GitHub informa "sha256:<hex>" nos arquivos das releases novas.
        sha256: /^sha256:([0-9a-f]{64})$/i.exec(exe.digest || '')?.[1]?.toLowerCase() || null,
      }
      : null,
  };
}

/** Script que espera o app fechar, apaga o exe antigo e abre o novo. */
function swapScript(oldExe, newExe) {
  return [
    '@echo off',
    'chcp 65001 >nul',
    'rem Troca o UnusHub portátil pela versão baixada, depois que o app fechar.',
    'set /a tentativas=0',
    ':espera',
    'timeout /t 1 /nobreak >nul',
    `del /f /q "${oldExe}" >nul 2>&1`,
    `if exist "${oldExe}" (`,
    '  set /a tentativas+=1',
    '  if %tentativas% lss 60 goto espera',
    ')',
    `start "" "${newExe}"`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
}

module.exports = { REPO, parseVersion, compareVersions, pickLatest, swapScript };
