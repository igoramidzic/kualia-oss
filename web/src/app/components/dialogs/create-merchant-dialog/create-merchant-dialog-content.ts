import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { ConvexError } from 'convex/values';
import { nucleoLoader as LoaderCircle, NucleoIcon, nucleoClose as X } from '@kualia/icons';
import { MerchantService } from '../../../services/merchant.service';
import {
  DEFAULT_MERCHANT_ICON_NAME,
  EntityIconColorId,
  VisualIdentityMode,
  randomEntityIconColorId,
} from '../../../shared/utils/entity-identity';
import { ContenteditableInputComponent } from '../../contenteditable-input/contenteditable-input.component';
import { EntityMarkComponent } from '../../entity-mark/entity-mark.component';
import { LogoPickerComponent } from '../../logo-picker/logo-picker.component';

@Component({
  selector: 'app-create-merchant-dialog-content',
  imports: [
    HlmButton,
    NucleoIcon,
    HlmDialogFooter,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
    LogoPickerComponent,
    EntityMarkComponent,
    ContenteditableInputComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './create-merchant-dialog-content.html',
})
export class CreateMerchantDialogContentComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly X = X;
  protected readonly defaultMerchantIconName = DEFAULT_MERCHANT_ICON_NAME;

  private readonly merchantService = inject(MerchantService);
  protected readonly dialogRef = injectBrnDialogContext<{ close: (result?: { _id: string; name: string }) => void }>();

  private readonly _creating = signal<boolean>(false);
  readonly creating = this._creating.asReadonly();
  readonly merchantName = signal<string>('');
  readonly logoUrl = signal<string | undefined>(undefined);
  readonly visualIdentityMode = signal<VisualIdentityMode>('logo');
  readonly iconName = signal<string>(DEFAULT_MERCHANT_ICON_NAME);
  readonly iconColorId = signal<EntityIconColorId | null>(null);
  readonly logoPickerState = signal<'open' | 'closed'>('closed');
  readonly nameError = signal<string | null>(null);

  onNameChange(name: string) {
    this.merchantName.set(name);
    this.nameError.set(null);
  }

  onLogoChange(logoUrl: string | null) {
    this.logoUrl.set(logoUrl ?? undefined);
    this.visualIdentityMode.set('logo');
    this.closeLogoPicker();
  }

  onLogoPickerStateChanged(state: 'open' | 'closed') {
    this.logoPickerState.set(state);
    if (state === 'open' && !this.iconColorId()) {
      this.iconColorId.set(randomEntityIconColorId());
    }
  }

  closeLogoPicker() {
    this.logoPickerState.set('closed');
  }

  onIdentityModeChange(mode: VisualIdentityMode) {
    this.visualIdentityMode.set(mode);
    if (mode === 'icon' && !this.iconColorId()) {
      this.iconColorId.set(randomEntityIconColorId());
    }
  }

  onIconChange(iconName: string) {
    this.iconName.set(iconName);
    this.visualIdentityMode.set('icon');
    if (!this.iconColorId()) {
      this.iconColorId.set(randomEntityIconColorId());
    }
  }

  onIconColorChange(iconColorId: EntityIconColorId) {
    this.iconColorId.set(iconColorId);
    this.visualIdentityMode.set('icon');
  }

  canSave(): boolean {
    const name = this.merchantName().trim();
    return name.length > 0 && name.length <= 100;
  }

  async createMerchant() {
    const name = this.merchantName().trim();

    if (!name) {
      this.nameError.set('Merchant name is required');
      return;
    }

    if (name.length > 100) {
      this.nameError.set('Merchant name must be less than 100 characters');
      return;
    }

    try {
      this._creating.set(true);
      this.nameError.set(null);

      const merchantId = await this.merchantService.createMerchant({
        name,
        logoUrl: this.logoUrl(),
        visualIdentityMode: this.visualIdentityMode(),
        iconName: this.iconName(),
        iconColorId: this.iconColorId() ?? undefined,
      });

      if (merchantId) {
        const result = { _id: merchantId, name };
        this.dialogRef.close(result);
      } else {
        throw new Error('Failed to create merchant');
      }
    } catch (error: unknown) {
      console.error('Error creating merchant:', error);
      const errorMessage = error instanceof ConvexError ? (error.data as string) : 'Failed to create merchant';
      this.nameError.set(errorMessage);
    } finally {
      this._creating.set(false);
    }
  }
}
