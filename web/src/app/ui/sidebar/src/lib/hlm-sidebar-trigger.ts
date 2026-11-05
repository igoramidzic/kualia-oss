import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { nucleoSidebar } from '@kualia/icons';
import { HlmButton, provideBrnButtonConfig } from '@spartan-ng/helm/button';
import { HlmIconImports } from '@spartan-ng/helm/icon';
import { HlmSidebarService } from './hlm-sidebar.service';

@Component({
  selector: 'button[hlmSidebarTrigger]',
  imports: [HlmIconImports],
  providers: [provideIcons({ nucleoSidebar }), provideBrnButtonConfig({ variant: 'ghost', size: 'icon' })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: HlmButton,
    },
  ],
  host: {
    'data-slot': 'sidebar-trigger',
    'data-sidebar': 'trigger',
    '(click)': '_onClick()',
  },
  template: ` <ng-icon hlm name="nucleoSidebar" size="sm"></ng-icon> `,
})
export class HlmSidebarTrigger {
  private readonly _hlmBtn = inject(HlmButton);
  private readonly _sidebarService = inject(HlmSidebarService);

  constructor() {
    this._hlmBtn.setClass('size-7');
  }

  protected _onClick(): void {
    this._sidebarService.toggleSidebar();
  }
}
