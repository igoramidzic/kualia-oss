export interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
}

const TAG_REGEX = /^<kualia-context>(.*?)<\/kualia-context>\s*\n*/s;

export function encodeKualiaContextTag(ctx: WorkspaceContext): string {
  const payload = JSON.stringify({ workspaceId: ctx.workspaceId, workspaceName: ctx.workspaceName });
  return `<kualia-context>${payload}</kualia-context>`;
}

export function parseKualiaContextTag(text: string): WorkspaceContext | null {
  const match = TAG_REGEX.exec(text);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['workspaceId'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['workspaceName'] === 'string'
    ) {
      const obj = parsed as Record<string, string>;
      return { workspaceId: obj['workspaceId'], workspaceName: obj['workspaceName'] };
    }
    return null;
  } catch {
    return null;
  }
}

export function stripKualiaContextTag(text: string): string {
  return text.replace(TAG_REGEX, '');
}
