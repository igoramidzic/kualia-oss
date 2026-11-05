import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { nucleoKey as KeyRound, NucleoIcon, nucleoPlus as Plus, nucleoTrash as Trash2 } from '@kualia/icons';
import { CreateApiKeyDialogComponent } from '../../../components/dialogs/create-api-key-dialog/create-api-key-dialog';
import { RevokeApiKeyDialogComponent } from '../../../components/dialogs/revoke-api-key-dialog/revoke-api-key-dialog';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { ConvexService } from '../../../services/convex.service';

type ApiKeyList = FunctionReturnType<typeof api.apiKeys.listApiKeys>;
type ApiKeyEntry = ApiKeyList[number];

@Component({
  selector: 'app-api-keys',
  imports: [DatePipe, HlmButton, HlmCard, NucleoIcon, SettingsPageHeaderComponent],
  templateUrl: './api-keys.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class ApiKeysComponent {
  protected readonly KeyRound = KeyRound;
  protected readonly Plus = Plus;
  protected readonly Trash2 = Trash2;

  private readonly convexService = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);

  private readonly keysQuery = this.convexService.query<ApiKeyList>(api.apiKeys.listApiKeys, {});

  protected readonly isLoading = computed(() => this.keysQuery() === undefined);
  protected readonly keys = computed(() => this.keysQuery() ?? []);

  protected isReadOnly(key: ApiKeyEntry): boolean {
    return !key.scopes.includes('write');
  }

  protected openCreateDialog(): void {
    const dialogRef = this.dialogService.open(CreateApiKeyDialogComponent, {
      context: {
        onClose: () => dialogRef.close(),
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  protected openRevokeDialog(key: ApiKeyEntry): void {
    const dialogRef = this.dialogService.open(RevokeApiKeyDialogComponent, {
      context: {
        apiKeyId: key.apiKeyId,
        label: key.label,
        keyPrefix: key.keyPrefix,
        onClose: () => dialogRef.close(),
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }
}
