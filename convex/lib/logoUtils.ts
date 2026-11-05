const PROD_APP_BASE_URL = 'https://app.kualia.com';
export const APPLE_WALLET_LOGO_PATH = '/images/apple-logo.jpeg';
export const APPLE_WALLET_LOGO_URL = `${PROD_APP_BASE_URL}${APPLE_WALLET_LOGO_PATH}`;

export function getAppleWalletLogoUrl(): string {
  return APPLE_WALLET_LOGO_URL;
}

/**
 * Strips Logo.dev token from logo URLs that use img.logo.dev
 * This ensures tokens are not persisted in the database
 */
export function stripLogoDevToken(logoUrl: string): string {
  if (!logoUrl.startsWith('https://img.logo.dev')) {
    return logoUrl;
  }
  // Remove ?token=... or &token=... from the URL
  const url = new URL(logoUrl);
  url.searchParams.delete('token');
  return url.toString();
}

/**
 * Appends Logo.dev token to logo URLs that use img.logo.dev
 */
export function appendLogoDevToken(logoUrl: string | null | undefined): string | undefined {
  if (!logoUrl) return logoUrl ?? undefined;

  if (logoUrl.startsWith('https://img.logo.dev')) {
    const token = process.env['LOGO_DEV_PUBLIC_TOKEN'];
    if (!token) {
      console.error('LOGO_DEV_PUBLIC_TOKEN is not set');
      return logoUrl;
    }

    const separator = logoUrl.includes('?') ? '&' : '?';
    return `${logoUrl}${separator}token=${token}`;
  }

  return logoUrl;
}

/**
 * Cleans and validates a base64 string before decoding
 * Removes whitespace, newlines, and validates base64 characters
 * @param base64String - The base64 string to clean
 * @returns Cleaned base64 string, or null if invalid
 */
export function cleanBase64String(base64String: string): string | null {
  if (!base64String || typeof base64String !== 'string') {
    return null;
  }

  // Remove whitespace, newlines, and other invalid characters
  let cleaned = base64String.replace(/[\s\n\r\t]/g, '');

  // Remove data URL prefix if present (handles both with and without MIME type)
  cleaned = cleaned.replace(/^data:image\/\w+;base64,/, '');
  cleaned = cleaned.replace(/^data:base64,/, '');

  // Validate base64 characters (A-Z, a-z, 0-9, +, /, =)
  // Base64 strings can also have padding with = characters
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(cleaned)) {
    return null;
  }

  // Check if string is too short (likely truncated)
  if (cleaned.length < 4) {
    return null;
  }

  return cleaned;
}
