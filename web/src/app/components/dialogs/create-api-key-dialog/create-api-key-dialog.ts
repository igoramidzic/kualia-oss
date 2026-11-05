import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import {
  nucleoCheck as Check,
  nucleoCopy as Copy,
  nucleoEye as Eye,
  nucleoEyeOff as EyeOff,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoWarning as TriangleAlert,
} from '@kualia/icons';
import { ConvexService } from '../../../services/convex.service';

type CreatedApiKey = FunctionReturnType<typeof api.apiKeys.createApiKey>;

interface DialogContext {
  onClose: (created?: boolean) => void;
}

@Component({
  selector: 'app-create-api-key-dialog',
  imports: [ReactiveFormsModule, HlmButton, HlmDialogHeader, HlmDialogFooter, HlmInput, HlmLabel, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (createdKey()) {
      <hlm-dialog-header>
        <h2 class="text-lg font-semibold">API key created</h2>
        <p class="text-muted-foreground text-sm">
          Copy your key now — for security reasons it will never be shown again.
        </p>
      </hlm-dialog-header>

      <div class="space-y-4 p-4">
        <div class="bg-muted flex items-center gap-2 rounded-lg border p-3">
          <code
            class="min-w-0 flex-1 text-sm break-all"
            [class.select-all]="revealed()"
            data-testid="created-api-key"
            >{{ displayKey() }}</code
          >
          <button
            hlmBtn
            type="button"
            size="sm"
            variant="outline"
            class="h-8 w-8 flex-shrink-0 p-0"
            (click)="toggleRevealed()"
            [attr.aria-label]="revealed() ? 'Hide API key' : 'Show API key'"
            data-testid="toggle-api-key-visibility"
          >
            @if (revealed()) {
              <nucleo-icon [icon]="EyeOff" class="h-4 w-4" />
            } @else {
              <nucleo-icon [icon]="Eye" class="h-4 w-4" />
            }
          </button>
          <button
            hlmBtn
            type="button"
            size="sm"
            variant="outline"
            class="flex-shrink-0"
            (click)="copyKey()"
            data-testid="copy-api-key"
          >
            @if (copied()) {
              <nucleo-icon [icon]="Check" class="h-4 w-4 text-green-500" />
              Copied
            } @else {
              <nucleo-icon [icon]="Copy" class="h-4 w-4" />
              Copy
            }
          </button>
        </div>

        <div class="text-muted-foreground flex items-start gap-2 text-sm">
          <nucleo-icon [icon]="TriangleAlert" class="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>Treat this key like a password. Anyone who has it can read and change your budget data.</p>
        </div>
      </div>

      <hlm-dialog-footer>
        <button hlmBtn type="button" size="sm" (click)="done()" data-testid="api-key-done">Done</button>
      </hlm-dialog-footer>
    } @else {
      <form [formGroup]="createForm" (ngSubmit)="createKey()">
        <hlm-dialog-header>
          <h2 class="text-lg font-semibold">Create API key</h2>
          <p class="text-muted-foreground text-sm">
            API keys let scripts and integrations access your Kualia data through the
            <a href="https://docs.kualia.com/api/overview" target="_blank" rel="noopener" class="underline"
              >public API</a
            >.
          </p>
        </hlm-dialog-header>

        <div class="space-y-4 p-4">
          <div class="space-y-2">
            <label hlmLabel for="api-key-label" class="text-sm">Name</label>
            <input
              hlmInput
              id="api-key-label"
              type="text"
              formControlName="label"
              placeholder="e.g. Budget sync script"
              maxlength="60"
              class="h-10 w-full"
              [disabled]="creating()"
            />
            @if (labelError) {
              <p class="text-destructive text-xs">{{ labelError }}</p>
            }
          </div>

          <label class="flex cursor-pointer items-start gap-3">
            <input type="checkbox" formControlName="readOnly" class="mt-1" [disabled]="creating()" />
            <span>
              <span class="block text-sm font-medium">Read-only</span>
              <span class="text-muted-foreground block text-sm">
                The key can fetch data but cannot create, edit, or delete anything.
              </span>
            </span>
          </label>

          @if (error()) {
            <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
              <p class="text-sm">{{ error() }}</p>
            </div>
          }
        </div>

        <hlm-dialog-footer>
          <button hlmBtn type="button" size="sm" variant="outline" (click)="cancel()" [disabled]="creating()">
            Cancel
          </button>
          <button hlmBtn type="submit" size="sm" [disabled]="createForm.invalid || creating()">
            @if (creating()) {
              <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
              Creating...
            } @else {
              Create Key
            }
          </button>
        </hlm-dialog-footer>
      </form>
    }
  `,
})
export class CreateApiKeyDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Copy = Copy;
  protected readonly Check = Check;
  protected readonly TriangleAlert = TriangleAlert;
  protected readonly Eye = Eye;
  protected readonly EyeOff = EyeOff;

  private readonly convexService = inject(ConvexService);
  private readonly fb = inject(FormBuilder);
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly createdKey = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly revealed = signal(false);

  /** The key, masked past its `kualia_` prefix until the user reveals it. */
  protected readonly displayKey = computed(() => {
    const key = this.createdKey();
    if (!key) return '';
    if (this.revealed()) return key;
    const prefixLength = key.indexOf('_') + 1;
    return key.slice(0, prefixLength) + '•'.repeat(24);
  });

  protected readonly createForm = this.fb.nonNullable.group({
    label: ['', [Validators.required.bind(Validators), Validators.maxLength(60).bind(Validators)]],
    readOnly: [false],
  });

  protected get labelError(): string | null {
    const control = this.createForm.controls.label;
    if (!control.touched || !control.errors) return null;
    if (control.errors['required']) return 'Enter a name for this key';
    if (control.errors['maxlength']) return 'Name cannot exceed 60 characters';
    return null;
  }

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected done(): void {
    this.dialogContext.onClose(true);
  }

  protected toggleRevealed(): void {
    this.revealed.update((revealed) => !revealed);
  }

  protected copyKey(): void {
    const key = this.createdKey();
    if (!key) return;
    void navigator.clipboard.writeText(key);
    this.copied.set(true);
    setTimeout(() => this.copied.set(false), 2000);
  }

  protected async createKey(): Promise<void> {
    if (this.createForm.invalid || this.creating()) {
      this.createForm.markAllAsTouched();
      return;
    }

    const label = this.createForm.controls.label.value.trim();
    const readOnly = this.createForm.controls.readOnly.value;

    this.creating.set(true);
    this.error.set(null);

    try {
      const result = await this.convexService.mutation<CreatedApiKey>(api.apiKeys.createApiKey, { label, readOnly });
      this.createdKey.set(result.key);
    } catch (error: unknown) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Failed to create API key';
      this.error.set(message);
    } finally {
      this.creating.set(false);
    }
  }
}
