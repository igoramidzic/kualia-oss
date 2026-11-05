import { describe, expect, it } from 'vitest';

import { formatBigIntAsDecimal, parseDecimalToBigIntMinorUnits, serializeBigInts } from './serialization';

describe('formatBigIntAsDecimal', () => {
  it('formats a positive amount with two fractional digits', () => {
    expect(formatBigIntAsDecimal(5108n, 2)).toBe('51.08');
  });

  it('keeps the sign for negative amounts', () => {
    expect(formatBigIntAsDecimal(-5108n, 2)).toBe('-51.08');
  });

  it('zero-pads amounts smaller than one major unit', () => {
    expect(formatBigIntAsDecimal(5n, 2)).toBe('0.05');
    expect(formatBigIntAsDecimal(-5n, 2)).toBe('-0.05');
    expect(formatBigIntAsDecimal(0n, 2)).toBe('0.00');
  });

  it('supports three-decimal currencies (e.g. KWD)', () => {
    expect(formatBigIntAsDecimal(1234567n, 3)).toBe('1234.567');
    expect(formatBigIntAsDecimal(7n, 3)).toBe('0.007');
  });

  it('returns the raw integer for zero-decimal currencies (e.g. JPY)', () => {
    expect(formatBigIntAsDecimal(100n, 0)).toBe('100');
    expect(formatBigIntAsDecimal(-100n, 0)).toBe('-100');
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER', () => {
    expect(formatBigIntAsDecimal(9007199254740993n, 2)).toBe('90071992547409.93');
  });
});

describe('parseDecimalToBigIntMinorUnits', () => {
  it('parses decimal strings into minor units', () => {
    expect(parseDecimalToBigIntMinorUnits('51.08', 2)).toBe(5108n);
    expect(parseDecimalToBigIntMinorUnits('-12.34', 2)).toBe(-1234n);
  });

  it('zero-pads inputs with fewer fractional digits than the currency', () => {
    expect(parseDecimalToBigIntMinorUnits('0.5', 2)).toBe(50n);
    expect(parseDecimalToBigIntMinorUnits('7.1', 2)).toBe(710n);
  });

  it('treats inputs with no decimal point as whole major units', () => {
    expect(parseDecimalToBigIntMinorUnits('-200', 2)).toBe(-20000n);
    expect(parseDecimalToBigIntMinorUnits('100', 0)).toBe(100n);
  });

  it('supports three-decimal currencies', () => {
    expect(parseDecimalToBigIntMinorUnits('1.234', 3)).toBe(1234n);
  });

  it('rejects more fractional digits than the currency supports', () => {
    expect(() => parseDecimalToBigIntMinorUnits('51.089', 2)).toThrow(
      'Amount has more fractional digits than the currency supports (max 2): 51.089'
    );
  });

  it('rejects non-numeric and malformed inputs', () => {
    expect(() => parseDecimalToBigIntMinorUnits('abc', 2)).toThrow('Invalid decimal amount: abc');
    expect(() => parseDecimalToBigIntMinorUnits('1.2.3', 2)).toThrow('Invalid decimal amount: 1.2.3');
    expect(() => parseDecimalToBigIntMinorUnits('+5', 2)).toThrow('Invalid decimal amount: +5');
    expect(() => parseDecimalToBigIntMinorUnits('.5', 2)).toThrow('Invalid decimal amount: .5');
    expect(() => parseDecimalToBigIntMinorUnits('5.', 2)).toThrow('Invalid decimal amount: 5.');
    expect(() => parseDecimalToBigIntMinorUnits('', 2)).toThrow('Invalid decimal amount: ');
  });

  it('round-trips with formatBigIntAsDecimal for canonical values', () => {
    for (const value of [5108n, -5108n, 5n, 0n, 120000n]) {
      expect(parseDecimalToBigIntMinorUnits(formatBigIntAsDecimal(value, 2), 2)).toBe(value);
    }
  });
});

describe('serializeBigInts', () => {
  it('renders bigints as raw integer strings when no minorUnit is given', () => {
    expect(serializeBigInts(5108n)).toBe('5108');
    expect(serializeBigInts(-5108n)).toBe('-5108');
  });

  it('renders bigints as decimal strings when a minorUnit is given', () => {
    expect(serializeBigInts(5108n, 2)).toBe('51.08');
    expect(serializeBigInts(100n, 0)).toBe('100');
  });

  it('recurses through arrays and nested objects, converting every bigint', () => {
    const payload = {
      currency: 'USD',
      total: 5108n,
      splits: [-5n, { amount: 100n, note: 'x' }],
      flag: true,
      missing: null,
    };

    expect(serializeBigInts(payload, 2)).toEqual({
      currency: 'USD',
      total: '51.08',
      splits: ['-0.05', { amount: '1.00', note: 'x' }],
      flag: true,
      missing: null,
    });
  });

  it('leaves non-bigint primitives untouched', () => {
    expect(serializeBigInts('hello', 2)).toBe('hello');
    expect(serializeBigInts(42, 2)).toBe(42);
    expect(serializeBigInts(false, 2)).toBe(false);
    expect(serializeBigInts(null, 2)).toBeNull();
    expect(serializeBigInts(undefined, 2)).toBeUndefined();
  });
});
