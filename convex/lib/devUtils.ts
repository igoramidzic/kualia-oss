/**
 * Development utility functions
 */

/**
 * Check if the current environment is development
 *
 * Development is detected by:
 * - CONVEX_SITE_URL matching the dev deployment URL
 * - CONVEX_CLOUD_URL containing localhost or 127.0.0.1
 *
 * @returns true if running in development environment
 */
export function isDev(): boolean {
  try {
    const url = new URL(process.env['CONVEX_CLOUD_URL'] ?? '');
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch (_error: unknown) {
    return false;
  }
}
