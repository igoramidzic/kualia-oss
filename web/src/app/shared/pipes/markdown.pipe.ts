import { Pipe, PipeTransform, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * Only allow safe URI schemes in href/src. Blocks javascript:, data:, vbscript:,
 * file:, etc. Also permits relative paths and in-page anchors.
 */
const SAFE_URI_REGEXP = /^(?:(?:https?|mailto):|[#./])/i;

/**
 * After sanitization, force every anchor to open in a new tab (preventing
 * reverse-tabnabbing through window.opener) and explicitly scrub `href`/`src`
 * URIs against SAFE_URI_REGEXP. The scrub is belt-and-braces over DOMPurify's
 * ALLOWED_URI_REGEXP, since some DOMPurify versions special-case `data:` on
 * images. Installed once at module load — DOMPurify hooks are global, but this
 * pipe is currently the only consumer.
 */
let sanitizationHookInstalled = false;
function installSanitizationHook(): void {
  if (sanitizationHookInstalled) return;
  sanitizationHookInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element)) return;
    for (const attr of ['href', 'src']) {
      const value = node.getAttribute(attr);
      if (value && !SAFE_URI_REGEXP.test(value)) {
        node.removeAttribute(attr);
      }
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Renders a Markdown string as sanitized HTML, suitable for binding via [innerHTML].
 *
 * Security:
 * - Output is sanitized by DOMPurify (strips <script>, event handlers, dangerous
 *   tags/attrs).
 * - URI schemes are restricted to http/https/mailto and relative/anchor links —
 *   `javascript:`, `data:`, etc. are dropped.
 * - All anchors are rewritten to open in a new tab with rel="noopener noreferrer".
 *
 * Usage:
 *   <div [innerHTML]="text | markdown"></div>
 */
@Pipe({
  name: 'markdown',
})
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);

  constructor() {
    installSanitizationHook();
  }

  transform(value: string | null | undefined): SafeHtml {
    if (!value) return '';
    const html = marked.parse(value, { async: false, gfm: true, breaks: true });
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
      ADD_ATTR: ['target', 'rel'],
    });
    return this.sanitizer.bypassSecurityTrustHtml(clean);
  }
}
