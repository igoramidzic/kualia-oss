export interface AttachmentTagEntry {
  filename: string;
  mediaType: string;
}

const TAG_REGEX = /<kualia-attachments>(.*?)<\/kualia-attachments>\s*\n*/s;

export function encodeKualiaAttachmentsTag(entries: readonly AttachmentTagEntry[]): string {
  const payload = JSON.stringify(entries.map((e) => ({ filename: e.filename, mediaType: e.mediaType })));
  return `<kualia-attachments>${payload}</kualia-attachments>`;
}

export function parseKualiaAttachmentsTag(text: string): AttachmentTagEntry[] | null {
  const match = TAG_REGEX.exec(text);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) return null;
    const result: AttachmentTagEntry[] = [];
    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['filename'] === 'string' &&
        typeof (item as Record<string, unknown>)['mediaType'] === 'string'
      ) {
        const obj = item as Record<string, string>;
        result.push({ filename: obj['filename'], mediaType: obj['mediaType'] });
      }
    }
    return result;
  } catch {
    return null;
  }
}

export function stripKualiaAttachmentsTag(text: string): string {
  return text.replace(TAG_REGEX, '');
}

/**
 * Backend-injected wrapper around the raw bytes of text-like attachments (CSV / TXT / JSON / …).
 * Anthropic-on-Bedrock only accepts PDFs as document file parts, so the agent backend inlines
 * non-PDF text payloads into the user message wrapped in this tag. The chat bubble strips them
 * out so the user sees only their own typed prompt + the chip row, never the file body.
 */
const ATTACHMENT_BODY_REGEX = /<kualia-attachment-body\b[^>]*>[\s\S]*?<\/kualia-attachment-body>\s*\n*/g;

export function stripKualiaAttachmentBodyTags(text: string): string {
  return text.replace(ATTACHMENT_BODY_REGEX, '');
}
