function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively serialize bigint values so payloads are JSON-safe.
 *
 * When `minorUnit` is provided, bigints are formatted as fixed-point decimal
 * strings (e.g. `5108n` with `minorUnit: 2` becomes `"51.08"`). All bigints in
 * MCP response payloads are money amounts, so this turns the wire format from
 * raw minor-units integers into the user-visible decimal — LLMs read `"51.08"`
 * directly instead of having to divide `"5108"` by 100, which they sometimes
 * silently skip and end up reporting `$5,108` for $51.08.
 *
 * When `minorUnit` is omitted, bigints fall back to their plain `toString()`
 * form (raw minor units) for callers that haven't migrated.
 */
export function serializeBigInts(value: unknown, minorUnit?: number): unknown {
  if (typeof value === 'bigint') {
    if (minorUnit === undefined) {
      return value.toString();
    }
    return formatBigIntAsDecimal(value, minorUnit);
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item, minorUnit));
  }

  if (isRecord(value)) {
    const serialized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      serialized[key] = serializeBigInts(nestedValue, minorUnit);
    }
    return serialized;
  }

  return value;
}

/**
 * Format a bigint amount in minor units as a fixed-point decimal string with
 * exactly `minorUnit` fractional digits. Negative values keep their sign.
 */
export function formatBigIntAsDecimal(value: bigint, minorUnit: number): string {
  if (minorUnit <= 0) return value.toString();
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const padded = abs.toString().padStart(minorUnit + 1, '0');
  const intPart = padded.slice(0, padded.length - minorUnit);
  const fracPart = padded.slice(padded.length - minorUnit);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Parse a fixed-point decimal string (e.g. `"51.08"`, `"-200"`, `"0.5"`) into
 * a bigint in minor units. Throws when the string isn't a valid decimal or has
 * more fractional digits than the currency's minor unit allows.
 *
 * `minorUnit` is the number of fractional digits the currency supports
 * (USD=2, JPY=0, KWD=3). Inputs with fewer fractional digits are zero-padded;
 * inputs with no decimal point are treated as whole major units.
 */
export function parseDecimalToBigIntMinorUnits(value: string, minorUnit: number): bigint {
  const match = value.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid decimal amount: ${value}`);
  }
  const [, sign, intPart, fracPart = ''] = match;
  if (fracPart.length > minorUnit) {
    throw new Error(`Amount has more fractional digits than the currency supports (max ${minorUnit}): ${value}`);
  }
  const padded = fracPart.padEnd(minorUnit, '0');
  const combined = `${sign}${intPart}${padded}`;
  return BigInt(combined);
}
