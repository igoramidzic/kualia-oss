export type AssistantSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'transactionLink'; url: string; workspaceShortId: string; transactionId: string };

const TAG_RE = /<transactionLink>\s*([^<\s][^<]*?)\s*<\/transactionLink>/gi;
const URL_RE = /^https?:\/\/[^/]+\/([a-z0-9]{8})\/transactions\/([a-z0-9]+)(?:\/details)?\/?$/i;

/**
 * Split assistant text into a sequence of markdown segments and transaction-link
 * cards. Tags whose inner URL doesn't match the expected shape fall back to a
 * markdown segment containing the original tag text, so a malformed tag from the
 * LLM degrades to literal text rather than breaking the UI.
 */
export function splitAssistantText(text: string): AssistantSegment[] {
  if (!text) return [];

  const segments: AssistantSegment[] = [];
  let cursor = 0;
  TAG_RE.lastIndex = 0;

  for (let match = TAG_RE.exec(text); match !== null; match = TAG_RE.exec(text)) {
    const [fullMatch, rawUrl] = match;
    const tagStart = match.index;
    const tagEnd = tagStart + fullMatch.length;

    const url = rawUrl.trim();
    const urlMatch = URL_RE.exec(url);

    if (!urlMatch) {
      // Malformed tag — leave it as literal text inside the surrounding markdown.
      continue;
    }

    if (tagStart > cursor) {
      segments.push({ kind: 'markdown', text: text.slice(cursor, tagStart) });
    }

    segments.push({
      kind: 'transactionLink',
      url,
      workspaceShortId: urlMatch[1].toLowerCase(),
      transactionId: urlMatch[2],
    });

    cursor = tagEnd;
  }

  if (cursor < text.length) {
    segments.push({ kind: 'markdown', text: text.slice(cursor) });
  }

  if (segments.length === 0) {
    segments.push({ kind: 'markdown', text });
  }

  return segments;
}
