export interface TimezoneInfo {
  /** IANA identifier, e.g. "Australia/Adelaide" */
  id: string;
  /** Readable location, e.g. "Adelaide, Australia" */
  city: string;
  /** Current UTC offset, e.g. "GMT+10:30" */
  offset: string;
  /** Lowercased text matched by search */
  searchText: string;
}

// Used only if the browser can't enumerate IANA timezones
const FALLBACK_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Australia/Adelaide',
  'Australia/Perth',
  'Pacific/Auckland',
];

const infoCache = new Map<string, TimezoneInfo | null>();
let allTimezones: TimezoneInfo[] | null = null;

function formatCity(id: string): string {
  const parts = id.split('/').map((part) => part.replace(/_/g, ' '));
  if (parts.length === 1) return parts[0];
  const city = parts[parts.length - 1];
  const region = parts.slice(0, -1).join(', ');
  return `${city}, ${region}`;
}

function getOffset(id: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: id, timeZoneName: 'shortOffset' }).formatToParts(
    new Date()
  );
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
}

function offsetMinutes(offset: string): number {
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(offset);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

export function getTimezoneInfo(id: string): TimezoneInfo | undefined {
  if (!infoCache.has(id)) {
    try {
      const city = formatCity(id);
      const offset = getOffset(id);
      infoCache.set(id, { id, city, offset, searchText: `${id} ${city} ${offset}`.toLowerCase() });
    } catch {
      infoCache.set(id, null);
    }
  }
  return infoCache.get(id) ?? undefined;
}

export function getAllTimezones(): TimezoneInfo[] {
  if (!allTimezones) {
    let ids: string[];
    try {
      ids = Intl.supportedValuesOf('timeZone');
    } catch {
      ids = FALLBACK_TIMEZONES;
    }
    allTimezones = ids
      .map((id) => getTimezoneInfo(id))
      .filter((info): info is TimezoneInfo => info !== undefined)
      .sort((a, b) => offsetMinutes(a.offset) - offsetMinutes(b.offset) || a.city.localeCompare(b.city));
  }
  return allTimezones;
}
