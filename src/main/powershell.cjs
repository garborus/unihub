// Consultas ao Windows pelo PowerShell (que já vem no Windows), sem módulo nativo.

const { execFile } = require('node:child_process');
const path = require('node:path');

// Caminho completo do PowerShell do Windows: não depende do PATH (que pode estar
// quebrado ou apontar para outro programa com o mesmo nome).
const POWERSHELL = path.join(process.env.SystemRoot || process.env.windir || 'C:\\Windows',
  'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

// A saída vem em UTF-8. Sem isto o PowerShell usa a página de código do console
// (850 no Brasil, 932 no Japão…): nomes com acento chegam trocados e, em alguns
// idiomas, quebram o JSON. O try cobre o caso de não haver console.
const UTF8_OUTPUT = 'try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}\n';

/**
 * Roda um comando do PowerShell sem janela. Nunca rejeita: devolve { err, stdout }.
 * @param {string} script
 * @param {number} [timeout]  em ms; 0 = sem limite
 */
function runPowerShell(script, timeout = 0) {
  return new Promise((resolve) => {
    execFile(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', UTF8_OUTPUT + script],
      { timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
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

module.exports = { POWERSHELL, runPowerShell, jsonList };
