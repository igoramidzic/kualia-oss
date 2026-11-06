import type { ArchiveFile } from '../dataExports/archive';
import { EXPORT_COLUMNS } from '../dataExports/columns';

export const MAX_EXPORT_BYTES = 8 * 1024 * 1024;
type Filename = keyof typeof EXPORT_COLUMNS;
type CsvRow<Name extends Filename> = Record<(typeof EXPORT_COLUMNS)[Name][number], string>;

// CSV fields in Kualia exports can contain quoted CRLFs as well as commas and quotes.
function* records(content: string): Generator<string[], void> {
  const token = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n|\n|$)/gy;
  let fields: string[] = [];
  token.lastIndex = content.startsWith('\uFEFF') ? 1 : 0;
  while (token.lastIndex < content.length) {
    const match = token.exec(content);
    if (!match) throw new Error('Invalid CSV quoting.');
    fields.push(match[1] === undefined ? match[2] : match[1].replace(/""/g, '"'));
    if (match[3] !== ',') {
      yield fields;
      fields = [];
    } else if (token.lastIndex === content.length) {
      yield [...fields, ''];
    }
  }
}

export function readExportTables(files: ArchiveFile[]) {
  if (files.reduce((n, f) => n + new TextEncoder().encode(f.content).length, 0) > MAX_EXPORT_BYTES) {
    throw new Error('Choose a Kualia export of 8 MiB or less.');
  }
  const expectedFiles = Object.keys(EXPORT_COLUMNS);
  if (files.some((file) => !expectedFiles.includes(file.name))) {
    throw new Error('Select only the four CSV files from a Kualia export.');
  }
  function table<N extends Filename>(name: N): CsvRow<N>[] {
    const matches = files.filter((f) => f.name === name);
    if (matches.length !== 1) throw new Error(`Select exactly one ${name} from the same Kualia export.`);
    try {
      const rows = records(matches[0].content);
      const first = rows.next();
      const header = first.done ? undefined : first.value;
      if (
        !header ||
        new Set(header).size !== header.length ||
        EXPORT_COLUMNS[name].some((column) => !header.includes(column))
      ) {
        throw new Error('Expected the column headings from a Kualia workspace export.');
      }
      return Array.from(rows, (cells, index) => {
        if (cells.length !== header.length) throw new Error(`Row ${index + 2} has the wrong number of columns.`);
        return Object.fromEntries(header.map((key, i) => [key, cells[i]])) as CsvRow<N>;
      });
    } catch (error: unknown) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : 'Invalid CSV.'}`);
    }
  }
  return {
    accounts: table('bank-accounts.csv'),
    categories: table('categories.csv'),
    plan: table('plan.csv'),
    transactions: table('transactions.csv'),
  };
}
