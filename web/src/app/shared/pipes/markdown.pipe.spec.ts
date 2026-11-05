import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { describe, expect, it } from 'vitest';
import { MarkdownPipe } from './markdown.pipe';

describe('MarkdownPipe', () => {
  let pipe: MarkdownPipe;
  let sanitizer: DomSanitizer;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    pipe = TestBed.runInInjectionContext(() => new MarkdownPipe());
    sanitizer = TestBed.inject(DomSanitizer);
  });

  const render = (input: string | null | undefined): string => {
    const result = pipe.transform(input);
    return sanitizer.sanitize(1 /* HTML */, result) ?? '';
  };

  it('returns empty string for empty/nullish input', () => {
    expect(pipe.transform('')).toBe('');
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });

  it('renders bold and italic markdown', () => {
    const html = render('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders bulleted lists', () => {
    const html = render('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('renders inline code and fenced code blocks', () => {
    const html = render('Use `npm install` then\n\n```\ncode\n```');
    expect(html).toContain('<code>npm install</code>');
    expect(html).toContain('<pre>');
  });

  it('renders links and opens them in a new tab safely', () => {
    const html = render('[docs](https://example.com/docs)');
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('>docs</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('opens raw HTML anchors in a new tab too', () => {
    const html = render('<a href="https://example.com">x</a>');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('strips dangerous script tags', () => {
    const html = render('hi <script>alert(1)</script> there');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
  });

  it('strips inline event handlers', () => {
    const html = render('<a href="https://example.com" onclick="alert(1)">link</a>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from markdown links', () => {
    const html = render('[click](javascript:alert(1))');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('alert(1)');
  });

  it('strips javascript: URLs from raw HTML anchors', () => {
    const html = render('<a href="javascript:alert(1)">x</a>');
    expect(html).not.toMatch(/href="javascript:/i);
    expect(html).not.toContain('alert(1)');
  });

  it('strips data: URLs in image sources', () => {
    const html = render('![x](data:text/html,<script>alert(1)</script>)');
    expect(html).not.toMatch(/src="data:/i);
    expect(html).not.toContain('alert(1)');
  });

  it('strips iframes', () => {
    const html = render('<iframe src="https://evil.example"></iframe>');
    expect(html).not.toContain('<iframe');
  });

  it('strips img onerror handlers', () => {
    const html = render('<img src="https://x" onerror="alert(1)">');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('alert(1)');
  });

  it('strips style tags and inline styles to prevent CSS-based exfiltration', () => {
    const html = render('<style>body{background:url(javascript:alert(1))}</style>plain');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('alert(1)');
  });

  it('escapes literal HTML entities so injected angle brackets stay text', () => {
    const html = render('a < b and c > d');
    expect(html).not.toContain('<b ');
    expect(html).not.toMatch(/<[bd]>/);
  });

  it('preserves single newlines as <br> when breaks is enabled', () => {
    const html = render('line one\nline two');
    expect(html).toContain('<br');
  });
});
