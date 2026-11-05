import { describe, expect, it } from 'vitest';

import { splitAssistantText } from './split-transaction-links';

const URL = 'https://app.kualia.com/797yc2h1/transactions/m171b170kk9y5v30yvn09b676n86pjs8/details';

describe('splitAssistantText', () => {
  it('returns an empty list for empty input', () => {
    expect(splitAssistantText('')).toEqual([]);
  });

  it('returns plain markdown when there are no tags', () => {
    expect(splitAssistantText('hello world')).toEqual([{ kind: 'markdown', text: 'hello world' }]);
  });

  it('extracts a single transaction link tag', () => {
    const text = `Here it is: <transactionLink>${URL}</transactionLink>`;
    const segments = splitAssistantText(text);
    expect(segments).toEqual([
      { kind: 'markdown', text: 'Here it is: ' },
      {
        kind: 'transactionLink',
        url: URL,
        workspaceShortId: '797yc2h1',
        transactionId: 'm171b170kk9y5v30yvn09b676n86pjs8',
      },
    ]);
  });

  it('extracts multiple tags with markdown in between', () => {
    const text = `First <transactionLink>${URL}</transactionLink> and second <transactionLink>${URL}</transactionLink>!`;
    const segments = splitAssistantText(text);
    expect(segments.map((s) => s.kind)).toEqual([
      'markdown',
      'transactionLink',
      'markdown',
      'transactionLink',
      'markdown',
    ]);
  });

  it('extracts a tag at the start of the string', () => {
    const text = `<transactionLink>${URL}</transactionLink> done`;
    const segments = splitAssistantText(text);
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe('transactionLink');
    expect(segments[1]).toEqual({ kind: 'markdown', text: ' done' });
  });

  it('falls back to markdown when the inner URL is malformed', () => {
    const text = 'Look: <transactionLink>not-a-url</transactionLink>';
    const segments = splitAssistantText(text);
    expect(segments).toEqual([{ kind: 'markdown', text }]);
  });

  it('accepts a URL without the /details suffix', () => {
    const url = 'https://app.kualia.com/797yc2h1/transactions/m171b170kk9y5v30yvn09b676n86pjs8';
    const text = `<transactionLink>${url}</transactionLink>`;
    const segments = splitAssistantText(text);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'transactionLink',
      workspaceShortId: '797yc2h1',
      transactionId: 'm171b170kk9y5v30yvn09b676n86pjs8',
    });
  });
});
