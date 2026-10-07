import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  importCsv, decode, detectDelimiter, parseCsv, mapColumns, errorsToCsv,
  parseNumber, parseDate, parseBoolean, parsePhone, parseDocument,
} from '../src/index.js';

const schema = [
  { key: 'name', label: 'Nome', aliases: ['nome completo', 'cliente'], required: true },
  { key: 'email', label: 'E-mail', aliases: ['email', 'correio'], type: 'email', required: true },
  { key: 'phone', label: 'Telefone', aliases: ['celular', 'whatsapp', 'fone'], type: 'phone' },
  { key: 'document', label: 'CPF/CNPJ', aliases: ['cpf', 'cnpj', 'documento'], type: 'document' },
  { key: 'value', label: 'Valor', aliases: ['valor mensal', 'mensalidade'], type: 'money', default: 0 },
  { key: 'since', label: 'Cliente desde', aliases: ['data de cadastro'], type: 'date' },
  { key: 'active', label: 'Ativo', type: 'boolean', default: true },
];

test('decodifica UTF-8 (com e sem BOM) e Windows-1252 do Excel', () => {
  assert.deepEqual(decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), { text: 'a', encoding: 'utf-8' });
  const excel = Buffer.from('Nome;Endereço\nJoão;Av. São João\n', 'latin1');
  const { text, encoding } = decode(excel);
  assert.equal(encoding, 'windows-1252');
  assert.ok(text.includes('João') && text.includes('Endereço'));
});

test('detecta ; , tab e |', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('nome;valor\n"Silva, Ana";"1.234,56"'), ';', 'vírgula dentro de aspas não conta');
});

test('parser RFC 4180: aspas, "" e quebra de linha dentro do campo', () => {
  const rows = parseCsv('a;b\r\n"linha 1\nlinha 2";"diz ""oi"""\r\n\r\n3;4\r\n', ';');
  assert.deepEqual(rows.map((r) => r.cells), [['a', 'b'], ['linha 1\nlinha 2', 'diz "oi"'], ['3', '4']]);
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 5], 'número da linha real no arquivo');
});

test('mapeia colunas por nome alternativo, sem acento e sem caixa', () => {
  const { mapping, unmapped, missingRequired } = mapColumns(['Nome completo', 'EMAIL', 'WhatsApp', 'Observação'], schema);
  assert.deepEqual(mapping, { name: 0, email: 1, phone: 2 });
  assert.deepEqual(unmapped, ['Observação']);
  assert.deepEqual(missingRequired, []);
  assert.deepEqual(mapColumns(['Nome'], schema).missingRequired, ['E-mail']);
});

test('conversores brasileiros', () => {
  assert.equal(parseNumber('R$ 1.234,56'), 1234.56);
  assert.equal(parseNumber('1234,5'), 1234.5);
  assert.equal(parseNumber('1234.5'), 1234.5);
  assert.equal(parseNumber('(150,00)'), -150, 'negativo contábil');
  assert.throws(() => parseNumber('abc'), /número inválido/);

  assert.equal(parseDate('15/10/2026'), '2026-10-15');
  assert.equal(parseDate('5-3-26'), '2026-03-05');
  assert.equal(parseDate('2026-10-15T10:00:00'), '2026-10-15');
  assert.equal(parseDate('46310'), '2026-10-15', 'número de série do Excel');
  assert.throws(() => parseDate('31/02/2026'), /inexistente/);

  assert.equal(parseBoolean('Sim'), true);
  assert.equal(parseBoolean('não'), false);
  assert.equal(parsePhone('(11) 98765-4321'), '+5511987654321');
  assert.equal(parseDocument('529.982.247-25'), '52998224725');
  // O Excel trata CPF como número e remove o zero à esquerda: 012.345.678-90 vira 1234567890
  assert.equal(parseDocument('1234567890'), '01234567890', 'zero à esquerda restaurado');
  assert.equal(parseDocument('12.abc.345/01de-35'), '12ABC34501DE35');
  assert.throws(() => parseDocument('111.111.111-11'), /inválido/);
});

test('importação completa: linhas válidas, erros por linha e duplicados', () => {
  const file = Buffer.from([
    'Nome completo;E-mail;Celular;CPF;Mensalidade;Data de cadastro;Ativo;Observação',
    'Maria Souza;MARIA@exemplo.com;(11) 98765-4321;529.982.247-25;R$ 149,90;15/01/2026;sim;cliente antiga',
    'João Lima;joao@exemplo;11 3456-7890;;99,9;;;',
    ';sem-nome@exemplo.com;;;;;;',
    'Ana Paula;ana@exemplo.com;;123;abc;31/02/2026;talvez;',
    'Maria S.;maria@exemplo.com;;;;;não;',
    '',
  ].join('\r\n'), 'latin1');

  const { rows, errors, meta } = importCsv(file, schema, { uniqueBy: 'email' });

  assert.equal(meta.encoding, 'windows-1252');
  assert.equal(meta.delimiter, ';');
  assert.deepEqual(meta.unmappedColumns, ['Observação']);
  assert.equal(meta.totalRows, 5);

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    line: 2,
    data: {
      name: 'Maria Souza', email: 'maria@exemplo.com', phone: '+5511987654321', document: '52998224725',
      value: 149.9, since: '2026-01-15', active: true,
    },
  });

  const byLine = (l) => errors.filter((e) => e.line === l).map((e) => e.field);
  assert.deepEqual(byLine(3), ['email'], 'e-mail sem domínio completo');
  assert.deepEqual(byLine(4), ['name']);
  assert.deepEqual(byLine(5), ['document', 'value', 'since', 'active'], 'todos os erros da linha de uma vez');
  assert.deepEqual(byLine(6), ['email'], 'duplicado de maria@exemplo.com');
  assert.match(errors.find((e) => e.line === 6).message, /linha 2/);
});

test('validação customizada e valor padrão', () => {
  const custom = [
    { key: 'name', required: true },
    { key: 'value', type: 'money', default: 0, validate: (v) => (v > 10_000 ? 'Valor acima do limite de R$ 10.000' : undefined) },
  ];
  const { rows, errors } = importCsv('name,value\nAna,\nBia,"20.000,00"', custom);
  assert.deepEqual(rows.map((r) => r.data), [{ name: 'Ana', value: 0 }]);
  assert.equal(errors[0].message, 'Valor acima do limite de R$ 10.000');
});

test('coluna obrigatória ausente e limite de linhas', () => {
  const missing = importCsv('Nome;Telefone\nAna;11987654321', schema);
  assert.match(missing.errors[0].message, /E-mail/);
  const big = importCsv(`Nome;E-mail\n${'a;a@b.co\n'.repeat(5)}`, schema, { maxRows: 3 });
  assert.match(big.errors[0].message, /excede o limite/);
});

test('relatório de erros para o Excel', () => {
  const csv = errorsToCsv([{ line: 3, field: 'email', value: '=HYPERLINK("x")', message: 'E-mail: inválido; confira' }]);
  assert.ok(csv.startsWith('﻿Linha;Campo;Valor;Problema'));
  assert.ok(csv.includes(`3;email;"'=HYPERLINK(""x"")";"E-mail: inválido; confira"`));
});
