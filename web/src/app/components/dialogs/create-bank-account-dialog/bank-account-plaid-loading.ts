import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { nucleoWarningCircle as AlertCircle, nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-bank-account-plaid-loading',
  imports: [NucleoIcon, HlmButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex min-h-[200px] flex-col items-center justify-center p-6">
      @if (isError()) {
        <nucleo-icon [icon]="AlertCircle" class="text-destructive mb-3 h-8 w-8" />
        <p class="text-foreground mb-2 font-medium">Connection Failed</p>
        <p class="text-muted-foreground mb-4 max-w-sm text-center text-sm">
          {{ errorMessage() || 'Unable to connect to your bank. Please try again or use manual entry.' }}
        </p>
        <div class="flex gap-2">
          <button hlmBtn variant="outline" size="sm" (click)="cancelClick.emit()">
            {{ showBackButton() ? 'Back' : 'Close' }}
          </button>
          <button hlmBtn variant="default" size="sm" (click)="retry.emit()">Try Again</button>
        </div>
      } @else if (isProcessing()) {
        <nucleo-icon [icon]="LoaderCircle" class="text-primary mb-3 h-8 w-8 animate-spin" />
        <p class="text-muted-foreground text-sm">Setting up your bank account...</p>
      } @else if (isWaiting()) {
        <p class="text-muted-foreground text-sm">Waiting for connection</p>
      } @else {
        <nucleo-icon [icon]="LoaderCircle" class="text-primary mb-3 h-8 w-8 animate-spin" />
        <p class="text-muted-foreground text-sm">Initializing secure connection...</p>
      }
    </div>
  `,
})
export class BankAccountPlaidLoadingComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly AlertCircle = AlertCircle;

  readonly isWaiting = input<boolean>(false);
  readonly isError = input<boolean>(false);
  readonly isProcessing = input<boolean>(false);
  readonly errorMessage = input<string | null>(null);
  readonly showBackButton = input<boolean>(true);

  readonly retry = output<void>();
  readonly cancelClick = output<void>();
}
