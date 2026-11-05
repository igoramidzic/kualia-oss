/**
 * Compute SHA-256 hash in lowercase hex.
 */
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashBytes = new Uint8Array(hashBuffer);
  return Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Compute SHA-256 hash encoded as base64url.
 */
export async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(hashBuffer));
}

/**
 * Generate a random OAuth token/code value.
 */
export function generateOpaqueToken(prefix: string): string {
  const randomBytes = new Uint8Array(32);
  crypto.getRandomValues(randomBytes);
  const tokenBody = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${prefix}${tokenBody}`;
}

/**
 * Generate a personal MCP token value.
 */
export function generateMcpTokenValue(): string {
  return generateOpaqueToken('kualia_mcp_');
}
