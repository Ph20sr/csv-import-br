# csv-import-br

[![CI](https://github.com/Ph20sr/csv-import-br/actions/workflows/ci.yml/badge.svg)](https://github.com/Ph20sr/csv-import-br/actions/workflows/ci.yml)
![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![license](https://img.shields.io/badge/license-MIT-blue)

Importação de planilhas para CRMs e sistemas de gestão, feita para **o CSV que o cliente realmente manda**: salvo pelo Excel em português, com `;`, acentos em Windows-1252, `R$ 1.234,56`, `15/10/2026` e colunas com o nome que cada um inventou. Não tem dependências.

## O que ele resolve

| o arquivo do cliente tem... | o csv-import-br... |
| --- | --- |
| acentos "quebrados" (`JoÃ£o`) | detecta UTF-8 ou Windows-1252 sozinho |
| `;` em vez de `,` | detecta o delimitador (vírgulas dentro de aspas não confundem) |
| "Nome completo", "Cliente", "nome" | liga ao mesmo campo via `aliases`, ignorando acento e maiúsculas |
| `R$ 1.234,56`, `(150,00)`, `99,9` | converte para número |
| `15/10/26`, `2026-10-15` ou `46310` (data do Excel) | converte para `2026-10-15` |
| CPF `1234567890` (o Excel "comeu" o zero) | restaura para `01234567890` e confere o dígito verificador |
| CNPJ alfanumérico | valida (padrão de 2026) |
| "Sim", "não", "x", "ativo" | vira `true` ou `false` |
| e-mail repetido | aponta "duplicado, já aparece na linha 2" |

Os erros vêm **por linha e por campo, todos de uma vez**, para o cliente corrigir a planilha numa só passada. O relatório de erros sai num CSV que abre direto no Excel.

## Uso

```js
import { importCsv, errorsToCsv } from 'csv-import-br';

const schema = [
  { key: 'name', label: 'Nome', aliases: ['nome completo', 'cliente'], required: true },
  { key: 'email', label: 'E-mail', aliases: ['email'], type: 'email', required: true },
  { key: 'phone', label: 'Telefone', aliases: ['celular', 'whatsapp'], type: 'phone' },
  { key: 'document', label: 'CPF/CNPJ', aliases: ['cpf', 'cnpj'], type: 'document' },
  { key: 'value', label: 'Mensalidade', type: 'money', default: 0,
    validate: (v) => (v > 10_000 ? 'Valor acima do limite' : undefined) },
  { key: 'since', label: 'Cliente desde', type: 'date' },
  { key: 'active', label: 'Ativo', type: 'boolean', default: true },
];

const file = await request.arrayBuffer();     // ou fs.readFileSync, ou File do navegador
const { rows, errors, meta } = importCsv(file, schema, { uniqueBy: 'email' });

// rows:   [{ line: 2, data: { name: 'Maria Souza', email: 'maria@exemplo.com', phone: '+5511987654321', value: 149.9, ... } }]
// errors: [{ line: 5, field: 'since', value: '31/02/2026', message: 'Cliente desde: data inexistente: "31/02/2026"' }]
// meta:   { encoding: 'windows-1252', delimiter: ';', totalRows: 5, unmappedColumns: ['Observação'], ... }

if (errors.length) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.end(errorsToCsv(errors));                // "Linha;Campo;Valor;Problema"
}
```

### Tipos

`string` · `number` · `money` · `integer` · `date` (→ `YYYY-MM-DD`) · `boolean` · `email` (minúsculo) · `phone` (→ `+55DDNNNNNNNNN`) · `document` (CPF/CNPJ com DV conferido)

### Fluxo recomendado

1. `importCsv` → mostre ao usuário: X linhas válidas, Y com erro, colunas ignoradas (`meta.unmappedColumns`)
2. Ofereça baixar o relatório de erros (`errorsToCsv`)
3. Grave `rows` em lote, numa transação

## Desenvolvimento

```bash
npm test
```

Os testes usam arquivos no formato real do Excel (Windows-1252, `;`, CRLF, linhas vazias no fim).

## Licença

MIT
