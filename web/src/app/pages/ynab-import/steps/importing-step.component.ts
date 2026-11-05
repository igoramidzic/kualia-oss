import { ChangeDetectionStrategy, Component, effect, input, output } from '@angular/core';
import {
  nucleoCheckCircle as CheckCircle2,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoCloseCircle as XCircle,
} from '@kualia/icons';
import type { ImportStatus } from '../../../services/ynab-import.service';
import { HlmProgress, HlmProgressIndicator } from '../../../ui/progress/src';

@Component({
  selector: 'app-importing-step',
  imports: [NucleoIcon, HlmProgress, HlmProgressIndicator],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-center gap-8 py-8">
      @if (importStatus(); as status) {
        @switch (status.status) {
          @case ('importing') {
            <!-- Loading Animation -->
            <div class="bg-primary/10 flex h-20 w-20 items-center justify-center rounded-full">
              <nucleo-icon [icon]="LoaderCircle" class="text-primary h-10 w-10 animate-spin" />
            </div>

            <!-- Current Step -->
            <div class="text-center">
              <p class="text-lg font-medium">{{ status.progress?.currentStep ?? 'Processing...' }}</p>
              <p class="text-muted-foreground mt-1 text-sm">Please don't close this window</p>
            </div>

            <!-- Progress Bars -->
            @if (status.progress) {
              <div class="w-full max-w-md space-y-4">
                <!-- Accounts Progress -->
                @if (status.progress.accountsTotal > 0) {
                  <div>
                    <div class="mb-1 flex justify-between text-sm">
                      <span>Accounts</span>
                      <span class="text-muted-foreground"
                        >{{ status.progress.accountsImported }} / {{ status.progress.accountsTotal }}</span
                      >
                    </div>
                    <hlm-progress
                      class="h-2"
                      [value]="getProgress(status.progress.accountsImported, status.progress.accountsTotal)"
                    >
                      <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                    </hlm-progress>
                  </div>
                }

                <!-- Categories Progress -->
                @if (status.progress.categoriesTotal > 0) {
                  <div>
                    <div class="mb-1 flex justify-between text-sm">
                      <span>Categories</span>
                      <span class="text-muted-foreground"
                        >{{ status.progress.categoriesImported }} / {{ status.progress.categoriesTotal }}</span
                      >
                    </div>
                    <hlm-progress
                      class="h-2"
                      [value]="getProgress(status.progress.categoriesImported, status.progress.categoriesTotal)"
                    >
                      <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                    </hlm-progress>
                  </div>
                }

                <!-- Transactions Progress -->
                @if (status.progress.transactionsTotal > 0) {
                  <div>
                    <div class="mb-1 flex justify-between text-sm">
                      <span>Transactions</span>
                      <span class="text-muted-foreground"
                        >{{ status.progress.transactionsImported }} / {{ status.progress.transactionsTotal }}</span
                      >
                    </div>
                    <hlm-progress
                      class="h-2"
                      [value]="getProgress(status.progress.transactionsImported, status.progress.transactionsTotal)"
                    >
                      <hlm-progress-indicator class="bg-primary transition-all duration-300" />
                    </hlm-progress>
                  </div>
                }
              </div>
            }
          }
          @case ('completed') {
            <!-- Success State -->
            <div class="bg-success/10 flex h-20 w-20 items-center justify-center rounded-full">
              <nucleo-icon [icon]="CheckCircle2" class="text-success h-10 w-10" />
            </div>
            <div class="text-center">
              <p class="text-lg font-medium">Import Complete!</p>
              <p class="text-muted-foreground mt-1 text-sm">Your data has been imported successfully</p>
            </div>
          }
          @case ('failed') {
            <!-- Error State -->
            <div class="bg-destructive/10 flex h-20 w-20 items-center justify-center rounded-full">
              <nucleo-icon [icon]="XCircle" class="text-destructive h-10 w-10" />
            </div>
            <div class="text-center">
              <p class="text-lg font-medium">Import Failed</p>
              <p class="text-muted-foreground mt-1 text-sm">
                {{ status.errorMessage ?? 'An error occurred during import' }}
              </p>
            </div>
          }
          @default {
            <!-- Pending/Parsing State -->
            <div class="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
              <nucleo-icon [icon]="LoaderCircle" class="text-muted-foreground h-10 w-10 animate-spin" />
            </div>
            <div class="text-center">
              <p class="text-lg font-medium">Preparing import...</p>
            </div>
          }
        }
      } @else {
        <!-- No Status Yet -->
        <div class="bg-muted flex h-20 w-20 items-center justify-center rounded-full">
          <nucleo-icon [icon]="LoaderCircle" class="text-muted-foreground h-10 w-10 animate-spin" />
        </div>
        <div class="text-center">
          <p class="text-lg font-medium">Starting import...</p>
          <p class="text-muted-foreground mt-1 text-sm">Please wait</p>
        </div>
      }
    </div>
  `,
})
export class ImportingStepComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly CheckCircle2 = CheckCircle2;
  protected readonly XCircle = XCircle;

  readonly importStatus = input<ImportStatus | null>(null);

  readonly importComplete = output<void>();
  readonly importFailed = output<string>();

  constructor() {
    // Watch for status changes and emit events
    effect(() => {
      const status = this.importStatus();
      if (status?.status === 'completed') {
        this.importComplete.emit();
      } else if (status?.status === 'failed') {
        this.importFailed.emit(status.errorMessage ?? 'Import failed');
      }
    });
  }

  getProgress(current: number, total: number): number {
    if (total === 0) return 0;
    return (current / total) * 100;
  }
}
