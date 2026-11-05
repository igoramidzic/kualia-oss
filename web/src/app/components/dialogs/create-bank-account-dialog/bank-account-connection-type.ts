import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogHeader } from '@spartan-ng/helm/dialog';
import {
  nucleoChevronRight as ChevronRight,
  nucleoPlusCircle as CirclePlus,
  nucleoBank as Landmark,
  NucleoIcon,
} from '@kualia/icons';

export type ConnectionType = 'linked' | 'manual';

@Component({
  selector: 'app-bank-account-connection-type',
  imports: [HlmButton, NucleoIcon, HlmDialogHeader, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Add a bank account</h2>
    </hlm-dialog-header>
    <div class="p-3">
      <div class="space-y-3">
        @if (isBankLinkingRegion()) {
          <!-- US/Canada: Show Link Bank Account first -->
          <ng-container *ngTemplateOutlet="linkBankButton" />
          <ng-container *ngTemplateOutlet="manualAccountButton" />
        } @else {
          <!-- Outside US/Canada: Show Manual Account first, Link Bank at bottom -->
          <ng-container *ngTemplateOutlet="manualAccountButton" />
          <ng-container *ngTemplateOutlet="linkBankButton" />
        }
      </div>
    </div>

    <!-- Link Bank Account Button Template -->
    <ng-template #linkBankButton>
      <button
        hlmBtn
        variant="secondary"
        class="bg-accent/50 h-auto w-full justify-start overflow-hidden p-4"
        [class.opacity-60]="!isBankLinkingRegion()"
        (click)="selectConnectionType('linked')"
      >
        <div class="flex w-full items-center gap-3">
          <nucleo-icon
            [icon]="linkIcon"
            class="mt-0.5 h-5 w-5 flex-shrink-0 self-start"
            [class.text-primary]="isBankLinkingRegion()"
            [class.text-muted-foreground]="!isBankLinkingRegion()"
          />
          <div class="min-w-0 flex-1 text-left">
            <div class="font-medium" [class.text-muted-foreground]="!isBankLinkingRegion()">Link Bank Account</div>
            <div class="mt-1 text-sm whitespace-normal" [class.text-muted-foreground]="isBankLinkingRegion()">
              @if (isBankLinkingRegion()) {
                Securely connect your bank account for automatic transaction import
              } @else {
                Only available in US & Canada
              }
            </div>
          </div>
          <nucleo-icon [icon]="chevronIcon" class="text-muted-foreground h-5 w-5 flex-shrink-0" />
        </div>
      </button>
    </ng-template>

    <!-- Manual Account Button Template -->
    <ng-template #manualAccountButton>
      <button
        hlmBtn
        variant="secondary"
        class="bg-accent/50 h-auto w-full justify-start overflow-hidden p-4"
        (click)="selectConnectionType('manual')"
      >
        <div class="flex w-full items-center gap-3">
          <nucleo-icon [icon]="manualIcon" class="text-primary mt-0.5 h-5 w-5 flex-shrink-0 self-start" />
          <div class="min-w-0 flex-1 text-left">
            <div class="font-medium">Manual Bank Account</div>
            <div class="text-muted-foreground mt-1 text-sm whitespace-normal">
              Create a bank account manually for tracking cash or other assets
            </div>
          </div>
          <nucleo-icon [icon]="chevronIcon" class="text-muted-foreground h-5 w-5 flex-shrink-0" />
        </div>
      </button>
    </ng-template>
  `,
})
export class BankAccountConnectionTypeComponent {
  protected readonly linkIcon = Landmark;
  protected readonly manualIcon = CirclePlus;
  protected readonly chevronIcon = ChevronRight;

  readonly connectionTypeSelected = output<ConnectionType>();

  /** Check if user's browser region is US or Canada (where Plaid bank linking is available) */
  protected readonly isBankLinkingRegion = signal(this.checkBankLinkingRegion());

  selectConnectionType(type: ConnectionType) {
    this.connectionTypeSelected.emit(type);
  }

  private checkBankLinkingRegion(): boolean {
    try {
      // Try to get the region from the browser's locale
      const locale = navigator.language ?? 'en-US';
      const regionCode = new Intl.Locale(locale).region?.toUpperCase();
      return regionCode === 'US' || regionCode === 'CA';
    } catch {
      // Fallback: check if locale string ends with -US or -CA
      const locale = navigator.language ?? '';
      return locale.endsWith('-US') || locale.endsWith('-CA');
    }
  }
}
