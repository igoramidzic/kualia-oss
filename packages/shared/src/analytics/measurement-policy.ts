/** Retained only for legacy clients and stored schema compatibility. */
export const WEB_MEASUREMENT_POLICY = 'us-opt-out-v1';

export function measurementPolicyResponse(): Response {
  // Fail closed for cached clients. There is no location lookup or opt-in path.
  return Response.json(
    { eligible: false, policy: WEB_MEASUREMENT_POLICY },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'no-store',
        'Cloudflare-CDN-Cache-Control': 'no-store',
        Vary: 'Sec-GPC, DNT',
        'X-Content-Type-Options': 'nosniff',
      },
    }
  );
}
