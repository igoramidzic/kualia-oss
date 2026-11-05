import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { NucleoIcon, nucleoClose as X } from '@kualia/icons';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';

@Component({
  selector: 'app-bank-account-sidebar',
  imports: [NucleoIcon, HlmButton],
  template: `
    @if (shouldRender()) {
      <aside [class]="sidebarClasses()" [attr.aria-hidden]="!isOpen()">
        <div class="flex h-full flex-col">
          <!-- Header -->
          <div class="flex hidden h-10 flex-shrink-0 items-center justify-between border-b px-3">
            <span class="text-sm font-medium">Details</span>
            <button
              hlmBtn
              variant="ghost"
              size="icon"
              class="text-muted-foreground hover:text-foreground h-6 w-6"
              (click)="close()"
              aria-label="Close sidebar"
            >
              <nucleo-icon [icon]="closeIcon" class="h-4 w-4" />
            </button>
          </div>

          <!-- Content (empty for now) -->
          <div class="flex-1 overflow-y-auto p-3">
            <p class="text-muted-foreground text-center text-sm">Coming soon</p>
          </div>
        </div>
      </aside>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BankAccountSidebarComponent {
  protected readonly closeIcon = X;
  private readonly userPreferencesService = inject(UserPreferencesService);

  protected readonly isOpen = this.userPreferencesService.bankAccountSidebarOpen;

  // Only enable transitions after first render to prevent animation flash on page load
  private readonly transitionsEnabled = signal(false);

  // Only render when open OR after initialization (to prevent flash when closed)
  protected readonly shouldRender = computed(() => this.isOpen() || this.transitionsEnabled());

  protected readonly sidebarClasses = computed(() => {
    const baseClasses = ['absolute', 'right-0', 'top-0', 'h-full', 'w-80', 'bg-content-background', 'border-l', 'z-20'];

    const isOpen = this.isOpen();
    const transitionsEnabled = this.transitionsEnabled();

    // Only add transition classes after first render
    if (transitionsEnabled) {
      baseClasses.push('transition-transform', 'duration-200', 'ease-in-out');
    }

    if (isOpen) {
      baseClasses.push('translate-x-0');
    } else {
      baseClasses.push('translate-x-full');
    }

    return baseClasses.join(' ');
  });

  constructor() {
    afterNextRender(() => {
      this.transitionsEnabled.set(true);
    });
  }

  close(): void {
    this.userPreferencesService.setBankAccountSidebarOpen(false);
  }
}
