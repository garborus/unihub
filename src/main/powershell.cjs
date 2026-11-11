// Consultas ao Windows pelo PowerShell (que já vem no Windows), sem módulo nativo.

const { execFile } = require('node:child_process');

/**
 * Roda um comando do PowerShell sem janela. Nunca rejeita: devolve { err, stdout }.
 * @param {string} script
 * @param {number} [timeout]  em ms; 0 = sem limite
 */
function runPowerShell(script, timeout = 0) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout, windowsHide: true }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

/**
 * Lista vinda de um `ConvertTo-Json @(...) -Compress`: sempre uma lista (o
 * PowerShell 5 devolve o objeto solto quando há um item só). Lança se não for JSON.
 */
function jsonList(stdout) {
  const value = JSON.parse(stdout.trim() || '[]');
  return Array.isArray(value) ? value : [value];
}

module.exports = { runPowerShell, jsonList };
