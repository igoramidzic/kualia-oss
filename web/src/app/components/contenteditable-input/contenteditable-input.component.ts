import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  forwardRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

@Component({
  selector: 'app-contenteditable-input',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ContenteditableInputComponent),
      multi: true,
    },
  ],
  template: `
    <div
      #editor
      contenteditable="true"
      spellcheck="true"
      role="textbox"
      [attr.aria-readonly]="disabled() ? 'true' : 'false'"
      [attr.aria-multiline]="'false'"
      [attr.aria-label]="ariaLabel()"
      translate="no"
      (focus)="onFocus($event)"
      (blur)="onBlur($event)"
      (beforeinput)="onBeforeInput($event)"
      (keydown)="onKeydown($event)"
      (input)="onInput()"
      class="ProseMirror editor relative w-full outline-none"
      [class]="className()"
      [attr.contenteditable]="!disabled()"
    >
      <p
        class="text-node"
        [class.editor-placeholder]="!value()"
        [attr.data-empty-text]="placeholder()"
        [attr.aria-hidden]="!value() ? 'true' : 'false'"
      >
        <br class="ProseMirror-trailingBreak" />
      </p>
    </div>
  `,
  styles: [
    `
      .ProseMirror.editor {
        cursor: text;
        overflow-wrap: break-word;
        word-break: break-word;
      }

      .ProseMirror.editor:focus {
        outline: none;
      }

      .text-node.editor-placeholder::before {
        content: attr(data-empty-text);
        color: hsl(var(--muted-foreground));
        pointer-events: none;
        position: absolute;
        opacity: 0.5;
      }

      .ProseMirror-trailingBreak {
        display: inline;
      }

      .text-node {
        position: relative;
        margin: 0;
        overflow-wrap: break-word;
        word-break: break-word;
      }
    `,
  ],
})
export class ContenteditableInputComponent implements AfterViewInit, ControlValueAccessor {
  readonly editor = viewChild<ElementRef>('editor');

  readonly placeholder = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly className = input<string>('text-2xl');
  readonly disabled = input<boolean>(false);
  readonly autoFocus = input<boolean>(false);

  readonly valueChange = output<string>();
  readonly enterPressed = output<void>();
  readonly escapePressed = output<void>();

  readonly value = signal<string>('');

  private onChange: (value: string) => void = () => {
    // Intentionally empty - will be set by Angular forms
  };
  private onTouched: () => void = () => {
    // Intentionally empty - will be set by Angular forms
  };

  ngAfterViewInit() {
    if (this.autoFocus()) {
      setTimeout(() => {
        const editor = this.editor()?.nativeElement as HTMLElement | undefined;
        editor?.focus();
      }, 100);
    }
  }

  writeValue(value: string): void {
    this.value.set(value ?? '');
    const editor = this.editor()?.nativeElement as HTMLElement | undefined;
    if (editor) {
      const paragraph = editor.querySelector('p');
      if (paragraph) {
        paragraph.textContent = value ?? '';
        if (!value) {
          const br = document.createElement('br');
          br.className = 'ProseMirror-trailingBreak';
          paragraph.appendChild(br);
        }
      }
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(): void {
    // Handled by the disabled input signal
  }

  onInput() {
    const editor = this.editor()?.nativeElement as HTMLElement | undefined;
    if (!editor) return;

    // Remove any extra paragraphs or divs that the browser might have created
    const allParagraphs = editor.querySelectorAll('p');
    if (allParagraphs.length > 1) {
      // Merge text content from all paragraphs
      let combinedText = '';
      allParagraphs.forEach((p) => {
        const text = p.textContent ?? '';
        if (text) combinedText += text;
      });

      // Remove all paragraphs except the first one
      allParagraphs.forEach((p, index) => {
        if (index > 0) p.remove();
      });

      // Update the first paragraph with combined text
      const mainParagraph = allParagraphs[0];
      if (mainParagraph) {
        mainParagraph.textContent = combinedText;
      }
    }

    // Ensure the p element exists (restore if deleted by backspace)
    let paragraph = editor.querySelector('p');
    if (!paragraph) {
      paragraph = document.createElement('p');
      paragraph.className = 'text-node';
      paragraph.setAttribute('data-empty-text', this.placeholder());
      paragraph.setAttribute('aria-hidden', 'true');
      const br = document.createElement('br');
      br.className = 'ProseMirror-trailingBreak';
      paragraph.appendChild(br);
      editor.appendChild(paragraph);

      // Place cursor in the restored paragraph
      const range = document.createRange();
      const selection = window.getSelection();
      if (selection) {
        range.selectNodeContents(paragraph);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    // Remove any divs that might have been created
    editor.querySelectorAll('div').forEach((div) => {
      const text = div.textContent ?? '';
      if (text && paragraph) {
        paragraph.textContent = (paragraph.textContent ?? '') + text;
      }
      div.remove();
    });

    const text = paragraph?.textContent?.trim() ?? '';
    this.value.set(text);
    this.onChange(text);
    this.valueChange.emit(text);

    // Ensure the br element exists when there's no text
    if (!text) {
      // Clear all content and add just the br
      paragraph.textContent = '';
      const br = document.createElement('br');
      br.className = 'ProseMirror-trailingBreak';
      paragraph.appendChild(br);
    }

    // Update placeholder class
    if (text) {
      paragraph.classList.remove('editor-placeholder');
      paragraph.setAttribute('aria-hidden', 'false');
    } else {
      paragraph.classList.add('editor-placeholder');
      paragraph.setAttribute('aria-hidden', 'true');
    }
  }

  onFocus(event: FocusEvent) {
    // Place cursor at the end of the text inside the p element
    const target = event.target as HTMLElement;
    const paragraph = target.querySelector('p');
    const range = document.createRange();
    const selection = window.getSelection();

    if (selection && paragraph) {
      // Check if paragraph has actual text content
      const hasText = paragraph.textContent && paragraph.textContent.trim().length > 0;

      if (hasText) {
        // If there's text, place cursor at the end
        const textNode = paragraph.firstChild;
        if (textNode?.nodeType === Node.TEXT_NODE) {
          range.setStart(textNode, textNode.textContent?.length ?? 0);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      } else {
        // If empty or only has br, position cursor appropriately
        if (paragraph.firstChild) {
          range.selectNodeContents(paragraph);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }
  }

  onBlur(event: FocusEvent) {
    const target = event.target as HTMLElement;
    const paragraph = target.querySelector('p');
    const newValue = paragraph?.textContent?.trim() ?? '';
    this.value.set(newValue);
    this.onChange(newValue);
    this.onTouched();
  }

  onBeforeInput(event: InputEvent) {
    const editor = this.editor()?.nativeElement as HTMLElement | undefined;
    if (!editor) return;

    const paragraph = editor.querySelector('p');
    if (!paragraph) return;

    // Prevent creating new lines on Enter
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault();
      return;
    }

    // Handle backspace/delete when content is empty
    if (event.inputType === 'deleteContentBackward' || event.inputType === 'deleteContentForward') {
      const text = paragraph.textContent?.trim() ?? '';

      // If the paragraph is empty (or only has whitespace), prevent deletion
      // This keeps the structure intact
      if (!text) {
        event.preventDefault();
        // Clear any text nodes but keep the br
        paragraph.textContent = '';
        const br = document.createElement('br');
        br.className = 'ProseMirror-trailingBreak';
        paragraph.appendChild(br);
        return;
      }
    }
  }

  onKeydown(event: KeyboardEvent) {
    const editor = this.editor()?.nativeElement as HTMLElement | undefined;
    const paragraph = editor?.querySelector('p');
    const text = paragraph?.textContent?.trim() ?? '';

    if (event.key === 'Enter') {
      event.preventDefault();
      this.enterPressed.emit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.escapePressed.emit();
    } else if (event.key === 'Backspace' && (event.metaKey || event.ctrlKey)) {
      // Handle cmd+backspace (Mac) or ctrl+backspace (Windows)
      // If the field is empty, prevent deletion
      if (!text) {
        event.preventDefault();
      }
    }
  }
}
