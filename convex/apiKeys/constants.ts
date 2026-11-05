/**
 * Personal API keys for the public REST API (https://api.kualia.com/v1).
 *
 * Keys are opaque bearer tokens prefixed `kualia_`. Only a SHA-256 hash is
 * stored; the raw value is returned once at creation time.
 */

export const API_KEY_PREFIX = 'kualia_';

/** Characters of the raw key kept for display in the settings UI. */
export const API_KEY_DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

/** Maximum number of active (non-revoked) keys per user. */
export const MAX_ACTIVE_API_KEYS = 20;

export const API_KEY_LABEL_MAX_LENGTH = 60;

/** Fixed-window rate limit applied per key by the public API. */
export const API_RATE_LIMIT_MAX_REQUESTS = 200;
export const API_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export type ApiKeyScope = 'read' | 'write';
