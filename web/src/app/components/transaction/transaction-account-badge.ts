import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import {
  DEFAULT_BANK_ACCOUNT_ICON_NAME,
  EntityIconColorId,
  VisualIdentityMode,
} from '../../shared/utils/entity-identity';
import { EntityMarkComponent } from '../entity-mark/entity-mark.component';

@Component({
  selector: 'app-transaction-account-badge',
  imports: [HlmBadge, EntityMarkComponent],
  template: `
    <span
      hlmBadge
      variant="outline"
      class="bg-content-background flex h-6 max-w-full min-w-14 items-center gap-1.5 overflow-hidden pl-1 font-normal"
    >
      <app-entity-mark
        [mode]="visualIdentityMode()"
        [logoUrl]="institutionLogo()"
        [iconName]="iconName() ?? defaultBankAccountIconName"
        [iconColorId]="iconColorId()"
        [defaultIconName]="defaultBankAccountIconName"
        [alt]="accountName()"
        size="xxs"
      />
      <span class="min-w-0 truncate text-sm">{{ accountName() }}</span>
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TransactionAccountBadgeComponent {
  readonly accountName = input.required<string>();
  readonly institutionLogo = input<string | null>(null);
  readonly visualIdentityMode = input<VisualIdentityMode | null | undefined>('logo');
  readonly iconName = input<string | null | undefined>(undefined);
  readonly iconColorId = input<EntityIconColorId | null | undefined>(undefined);
  protected readonly defaultBankAccountIconName = DEFAULT_BANK_ACCOUNT_ICON_NAME;
}
