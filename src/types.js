// Conversores de valores no formato brasileiro. Cada um devolve o valor
// convertido ou lança Error com uma mensagem para mostrar ao usuário.

const digits = (v) => String(v).replace(/\D/g, '');

/** "1.234,56" | "1234,56" | "1234.56" | "R$ 1.234,56" | "-10" → número */
export function parseNumber(value) {
  let s = String(value).trim().replace(/R\$|\s/g, '');
  if (!s) throw new Error('valor vazio');
  const negative = /^-|^\(.*\)$/.test(s);
  s = s.replace(/^[-(]|\)$/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`número inválido: "${value}"`);
  const n = Number(s);
  return negative ? -n : n;
}

/** "15/10/2026" | "15-10-2026" | "2026-10-15" | "15/10/26" | número de série do Excel → "2026-10-15" */
export function parseDate(value) {
  const s = String(value).trim();
  let y;
  let m;
  let d;
  let match;
  if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) {
    [, d, m, y] = match;
    if (y.length === 2) y = String(Number(y) < 70 ? 2000 + Number(y) : 1900 + Number(y));
  } else if ((match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s))) {
    [, y, m, d] = match;
  } else if (/^\d{5}$/.test(s)) {
    // Data como número de série do Excel (dias desde 30/12/1899)
    return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86_400_000).toISOString().slice(0, 10);
  } else {
    throw new Error(`data inválida: "${value}" (use dd/mm/aaaa)`);
  }
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso) throw new Error(`data inexistente: "${value}"`);
  return iso;
}

const TRUE = new Set(['sim', 's', 'yes', 'y', 'true', 'verdadeiro', '1', 'x', 'ativo']);
const FALSE = new Set(['nao', 'não', 'n', 'no', 'false', 'falso', '0', 'inativo', '']);
export function parseBoolean(value) {
  const s = String(value).trim().toLowerCase();
  if (TRUE.has(s)) return true;
  if (FALSE.has(s)) return false;
  throw new Error(`esperado sim/não: "${value}"`);
}

export function parseEmail(value) {
  const s = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw new Error(`e-mail inválido: "${value}"`);
  return s;
}

/** Telefone BR → "+55DDNNNNNNNNN" */
export function parsePhone(value) {
  let d = digits(value);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) throw new Error(`telefone inválido: "${value}" (inclua o DDD)`);
  return `+55${d}`;
}

function cpfValid(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1+$/.test(cpf)) return false;
  const dv = (base) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (base.length + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(cpf.slice(0, 9)) === Number(cpf[9]) && dv(cpf.slice(0, 10)) === Number(cpf[10]);
}

function cnpjValid(cnpj) {
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1+$/.test(cnpj)) return false;
  const dv = (base, weights) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += (base.charCodeAt(i) - 48) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(cnpj.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${d1}${d2}` === cnpj.slice(12);
}

/** CPF ou CNPJ (inclusive alfanumérico) → só dígitos/letras, com DV conferido. */
export function parseDocument(value) {
  let s = String(value).toUpperCase().replace(/[^0-9A-Z]/g, '');
  // Excel costuma "comer" o zero à esquerda de CPFs
  if (/^\d{9,10}$/.test(s)) s = s.padStart(11, '0');
  if (/^\d{12,13}$/.test(s)) s = s.padStart(14, '0');
  if (s.length === 11 ? cpfValid(s) : cnpjValid(s)) return s;
  throw new Error(`CPF/CNPJ inválido: "${value}"`);
}

export function parseString(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

export const TYPES = {
  string: parseString,
  number: parseNumber,
  money: parseNumber,
  integer: (v) => {
    const n = parseNumber(v);
    if (!Number.isInteger(n)) throw new Error(`esperado número inteiro: "${v}"`);
    return n;
  },
  date: parseDate,
  boolean: parseBoolean,
  email: parseEmail,
  phone: parsePhone,
  document: parseDocument,
};
