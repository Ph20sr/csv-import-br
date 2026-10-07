// Leitura de CSV "do mundo real": arquivos do Excel brasileiro (";" e
// Windows-1252), BOM, aspas, quebras de linha dentro de campos.

/**
 * Decodifica bytes para texto. Tenta UTF-8 estrito; se falhar, é quase
 * certamente um CSV salvo pelo Excel no Windows (Windows-1252).
 */
export function decode(input) {
  if (typeof input === 'string') return { text: input.replace(/^﻿/, ''), encoding: 'utf-8' };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(hasBom ? bytes.subarray(3) : bytes);
    return { text, encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

const CANDIDATES = [';', ',', '\t', '|'];

/** Conta delimitadores fora de aspas em cada uma das primeiras linhas. */
function countOutsideQuotes(line, delimiter) {
  let inQuotes = false;
  let n = 0;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delimiter && !inQuotes) n++;
  }
  return n;
}

/**
 * Escolhe o delimitador que aparece com mais frequência e de forma
 * consistente nas primeiras linhas (o Excel em pt-BR salva com ";").
 */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',';
  let bestScore = -1;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    if (!counts.length || counts[0] === 0) continue;
    const consistent = counts.filter((c) => c === counts[0]).length / counts.length;
    const score = counts[0] * consistent;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/** Parser RFC 4180: aspas, "" escapado, quebras de linha dentro de campos, CRLF. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push({ line: rowLine, cells: row });
      row = [];
      field = '';
      line++;
      rowLine = line;
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push({ line: rowLine, cells: row });
  }
  // Remove linhas totalmente vazias (comuns no fim de arquivos do Excel)
  return rows.filter((r) => r.cells.some((c) => c.trim() !== ''));
}
