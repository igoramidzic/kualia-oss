import { describe, expect, it } from 'vitest';
import { calculateCrc32, createZipArchive, readExportArchive } from './archive';

describe('data export ZIP archive', () => {
  it('calculates the standard CRC-32 check value', () => {
    expect(calculateCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes local files, a central directory, and an end record', () => {
    const archive = createZipArchive(
      [
        { name: 'categories.csv', content: 'name\r\nGroceries\r\n' },
        { name: 'transactions.csv', content: 'transaction_id\r\nt_1\r\n' },
      ],
      new Date('2026-08-18T12:00:00.000Z')
    );
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const decoded = new TextDecoder().decode(archive);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(decoded).toContain('categories.csv');
    expect(decoded).toContain('transactions.csv');
    expect(view.getUint32(archive.byteLength - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.byteLength - 12, true)).toBe(2);
  });
});

describe('Kualia import archive integrity', () => {
  it('rejects a truncated ZIP and a damaged CSV payload', () => {
    const zip = Uint8Array.from(createZipArchive([{ name: 'plan.csv', content: 'header\r\n' }]));
    expect(() => readExportArchive(zip.slice(0, -1).buffer)).toThrow(/Invalid Kualia ZIP/);
    zip[30 + 'plan.csv'.length] ^= 1;
    expect(() => readExportArchive(zip.buffer)).toThrow(/Invalid Kualia ZIP/);
  });
});
