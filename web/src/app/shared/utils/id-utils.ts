/**
 * Gets the short version of an ID (last 8 characters)
 * This is used for display and navigation purposes
 */
export function getShortId(id: string): string {
  return id.slice(-8);
}

/**
 * Gets the full ID from a potential short ID by searching in a collection
 * Returns null if not found
 */
export function findFullId<T extends { id: string }>(shortOrFullId: string, items: T[]): string | null {
  // First check if it's already a full ID
  const exactMatch = items.find((item) => item.id === shortOrFullId);
  if (exactMatch) {
    return exactMatch.id;
  }

  // Then check if it's a short ID (last 8 chars)
  if (shortOrFullId.length === 8) {
    const shortIdMatch = items.find((item) => item.id.endsWith(shortOrFullId));
    if (shortIdMatch) {
      return shortIdMatch.id;
    }
  }

  return null;
}
