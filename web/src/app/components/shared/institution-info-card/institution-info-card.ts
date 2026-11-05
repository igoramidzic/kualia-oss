import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { nucleoBank as Building2, NucleoIcon } from '@kualia/icons';

@Component({
  selector: 'app-institution-info-card',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-4" [class.mb-3]="accountInfo()">
      @if (logoUrl()) {
        <img [src]="logoUrl()!" [alt]="institutionName()" class="h-10 w-10 rounded-full object-contain" />
      } @else {
        <div class="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
          <nucleo-icon [icon]="Building2" [size]="20" class="text-muted-foreground" />
        </div>
      }

      <div>
        <h4 class="font-medium">{{ institutionName() }}</h4>
      </div>
    </div>

    @if (accountInfo()) {
      <div class="border-border border-t pt-3">
        <p class="text-muted-foreground mb-1 text-xs">{{ accountInfoLabel() }}</p>
        <p class="font-medium">{{ accountInfo() }}</p>
      </div>
    }
  `,
})
export class InstitutionInfoCardComponent {
  // Inputs
  readonly logoUrl = input<string | undefined>();
  readonly institutionName = input.required<string>();
  readonly accountInfo = input<string>();
  readonly accountInfoLabel = input<string>('Account Name');

  // Icons
  protected readonly Building2 = Building2;
}
