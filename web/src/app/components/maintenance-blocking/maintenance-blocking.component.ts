import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { NucleoIcon, nucleoMaintenance as Wrench } from '@kualia/icons';

@Component({
  selector: 'app-maintenance-blocking',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NucleoIcon],
  styles: `
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }
    .pulse-dot {
      animation: pulse 1.2s ease-in-out infinite;
    }
  `,
  template: `
    <div class="bg-background flex h-screen w-screen items-center justify-center">
      <div class="flex max-w-md flex-col items-center gap-6 px-4 text-center">
        <nucleo-icon [icon]="WrenchIcon" class="text-muted-foreground h-16 w-16" />

        <div class="space-y-2">
          <h1 class="text-2xl font-semibold tracking-tight">Under Maintenance</h1>
          <p class="text-muted-foreground">
            {{ message() ?? "We're currently performing maintenance. Please check back shortly." }}
          </p>
        </div>

        <div class="flex items-center gap-2.5 pt-6">
          <span class="pulse-dot h-2.5 w-2.5 rounded-full bg-orange-500"></span>
          <span class="text-muted-foreground text-sm">This page will update automatically</span>
        </div>
      </div>
    </div>
  `,
})
export class MaintenanceBlockingComponent {
  protected readonly WrenchIcon = Wrench;

  readonly message = input<string | null>(null);
}
