// Salt Edge API configuration
export const saltedgeConfig = {
  appId: process.env['SALTEDGE_APP_ID'],
  secret: process.env['SALTEDGE_SECRET'],
  baseUrl:
    process.env['SALTEDGE_ENV'] === 'production'
      ? 'https://www.saltedge.com/api/v6'
      : 'https://www.saltedge.com/api/v6', // Sandbox uses same base URL
  privateKey: process.env['SALTEDGE_PRIVATE_KEY'],
  // RSA signatures are optional for testing/sandbox, required for production
  // Note: Signatures require Node.js crypto module which is not available in Convex
  // For production, you'll need to implement signing in a separate Node.js service
  useSignatures: false, // Disabled - not supported in Convex environment
};

/**
 * Make authenticated request to Salt Edge API
 */
export async function saltedgeRequest<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  const { method = 'GET', body } = options;

  if (!saltedgeConfig.appId || !saltedgeConfig.secret) {
    throw new Error('SALTEDGE_APP_ID and SALTEDGE_SECRET must be set');
  }

  // Build full URL
  const url = `${saltedgeConfig.baseUrl}${endpoint}`;

  // Prepare request body
  const bodyString = body ? JSON.stringify(body) : undefined;

  // Prepare headers
  const headers: Record<string, string> = {
    'App-id': saltedgeConfig.appId,
    Secret: saltedgeConfig.secret,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // Note: RSA signatures not currently supported in Convex serverless environment
  // Sandbox mode works without signatures (App-id + Secret only)
  // For production with signatures, consider using an external Node.js service

  // Make request
  const response = await fetch(url, {
    method,
    headers,
    body: bodyString,
  });

  // Parse response
  const responseData = await response.json();

  if (!response.ok) {
    const error = responseData.error ?? responseData;
    throw new Error(`Salt Edge API error: ${error.message ?? error.class ?? 'Unknown error'}`);
  }

  return responseData as T;
}

/**
 * Helper to validate Salt Edge configuration
 */
export function validateSaltEdgeConfig(): void {
  const missing: string[] = [];

  if (!saltedgeConfig.appId) missing.push('SALTEDGE_APP_ID');
  if (!saltedgeConfig.secret) missing.push('SALTEDGE_SECRET');

  if (missing.length > 0) {
    throw new Error(`Missing Salt Edge configuration: ${missing.join(', ')}`);
  }
}
