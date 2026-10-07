import { decode, detectDelimiter, parseCsv } from './csv.js';
import { TYPES } from './types.js';

/** "E-mail do Cliente" → "email do cliente" (sem acento, pontuação ou espaços extras). */
export function normalizeHeader(h) {
  return String(h ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Liga as colunas do arquivo aos campos do schema, aceitando nomes
 * alternativos: "Celular", "WhatsApp" e "Telefone" podem virar `phone`.
 */
export function mapColumns(headers, schema) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  const used = new Set();
  for (const field of schema) {
    const names = [field.key, field.label, ...(field.aliases ?? [])].filter(Boolean).map(normalizeHeader);
    const index = normalized.findIndex((h, i) => !used.has(i) && names.includes(h));
    if (index !== -1) {
      mapping[field.key] = index;
      used.add(index);
    }
  }
  return {
    mapping,
    unmapped: headers.filter((_, i) => !used.has(i)),
    missingRequired: schema.filter((f) => f.required && mapping[f.key] === undefined).map((f) => f.label ?? f.key),
  };
}

/**
 * Importa um CSV contra um schema.
 *
 * @param {string | Uint8Array | ArrayBuffer} input conteúdo do arquivo
 * @param {{ key: string, label?: string, aliases?: string[], type?: string, required?: boolean, default?: any, validate?: (v, row) => string | void }[]} schema
 * @param {{ delimiter?: string, maxRows?: number, uniqueBy?: string }} [options]
 * @returns {{ rows: { line: number, data: object }[], errors: { line: number, field?: string, value?: string, message: string }[], meta: object }}
 */
export function importCsv(input, schema, { delimiter, maxRows = 50_000, uniqueBy } = {}) {
  const { text, encoding } = decode(input);
  const sep = delimiter ?? detectDelimiter(text);
  const table = parseCsv(text, sep);
  const meta = { encoding, delimiter: sep, totalRows: Math.max(0, table.length - 1) };

  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'Arquivo vazio' }], meta };
  const [header, ...body] = table;
  const columns = mapColumns(header.cells, schema);
  Object.assign(meta, { columns: columns.mapping, unmappedColumns: columns.unmapped, missingRequired: columns.missingRequired });

  if (columns.missingRequired.length) {
    return {
      rows: [],
      errors: [{ line: header.line, message: `Coluna obrigatória não encontrada: ${columns.missingRequired.join(', ')}` }],
      meta,
    };
  }
  if (body.length > maxRows) {
    return { rows: [], errors: [{ line: 1, message: `Arquivo com ${body.length} linhas excede o limite de ${maxRows}` }], meta };
  }

  const rows = [];
  const errors = [];
  const seen = new Map();

  for (const { line, cells } of body) {
    const data = {};
    const rowErrors = [];
    for (const field of schema) {
      const index = columns.mapping[field.key];
      const raw = index === undefined ? '' : (cells[index] ?? '').trim();
      if (raw === '') {
        if (field.required) rowErrors.push({ line, field: field.key, value: raw, message: `${field.label ?? field.key} é obrigatório` });
        else data[field.key] = field.default ?? null;
        continue;
      }
      try {
        data[field.key] = (TYPES[field.type ?? 'string'] ?? TYPES.string)(raw);
      } catch (err) {
        rowErrors.push({ line, field: field.key, value: raw, message: `${field.label ?? field.key}: ${err.message}` });
      }
    }

    if (!rowErrors.length) {
      for (const field of schema) {
        const msg = field.validate?.(data[field.key], data);
        if (msg) rowErrors.push({ line, field: field.key, value: String(data[field.key] ?? ''), message: msg });
      }
    }

    if (!rowErrors.length && uniqueBy && data[uniqueBy] != null) {
      const key = String(data[uniqueBy]).toLowerCase();
      if (seen.has(key)) {
        rowErrors.push({ line, field: uniqueBy, value: String(data[uniqueBy]), message: `Duplicado (já aparece na linha ${seen.get(key)})` });
      } else seen.set(key, line);
    }

    if (rowErrors.length) errors.push(...rowErrors);
    else rows.push({ line, data });
  }

  return { rows, errors, meta };
}

/** Relatório de erros em CSV (";" e BOM, para abrir direto no Excel). */
export function errorsToCsv(errors) {
  const cell = (v) => {
    const s = String(v ?? '');
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `﻿${['Linha;Campo;Valor;Problema', ...errors.map((e) => [e.line, e.field, e.value, e.message].map(cell).join(';'))].join('\r\n')}`;
}
