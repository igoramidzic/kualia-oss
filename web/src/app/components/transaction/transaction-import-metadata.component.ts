import { Component, computed, inject, input, signal } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import {
  nucleoChevronDown as ChevronDown,
  nucleoChevronUp as ChevronUp,
  nucleoFile as FileText,
  NucleoIcon,
} from '@kualia/icons';
import { CurrencyService } from '../../services/currency.service';

@Component({
  selector: 'app-transaction-import-metadata',
  imports: [NucleoIcon, HlmCard, HlmButton],
  template: `
    @if (importMetadata()) {
      <div hlmCard class="w-fit">
        <div class="p-4">
          <!-- Header with name and date -->
          <div class="mb-3 flex items-start justify-between">
            <div class="flex-1">
              <div class="mb-1 flex items-center gap-2">
                <nucleo-icon [icon]="FileText" class="text-muted-foreground h-4 w-4" />
                <h4 class="text-sm font-medium">Import Details</h4>
              </div>
              @if (originalStatementText()) {
                <p class="text-sm">{{ originalStatementText() }}</p>
              }
              @if (importMetadata()!.date) {
                <p class="text-muted-foreground text-xs">{{ formatDate(importMetadata()!.date) }}</p>
              }
            </div>
            <button hlmBtn variant="ghost" size="sm" type="button" class="h-8 w-8 p-0" (click)="toggleExpanded()">
              <nucleo-icon [icon]="isExpanded() ? ChevronUp : ChevronDown" class="h-4 w-4" />
            </button>
          </div>

          <!-- Expanded details -->
          @if (isExpanded()) {
            <div class="space-y-2 border-t pt-3">
              @if (importMetadata()!.merchantName) {
                <div class="grid grid-cols-3 gap-2">
                  <span class="text-muted-foreground text-xs">Merchant Name</span>
                  <span class="col-span-2 text-xs">{{ importMetadata()!.merchantName }}</span>
                </div>
              }
              @if (originalStatementText()) {
                <div class="grid grid-cols-3 gap-2">
                  <span class="text-muted-foreground text-xs">Original Statement</span>
                  <span class="col-span-2 text-xs">{{ originalStatementText() }}</span>
                </div>
              }
              @if (importMetadata()!.amount !== null && importMetadata()!.amount !== undefined) {
                <div class="grid grid-cols-3 gap-2">
                  <span class="text-muted-foreground text-xs">Original Amount</span>
                  <span class="col-span-2 text-xs">{{ formatAmount(importMetadata()!.amount) }}</span>
                </div>
              }
              @if (importMetadata()!.authorizedDate) {
                <div class="grid grid-cols-3 gap-2">
                  <span class="text-muted-foreground text-xs">Authorized Date</span>
                  <span class="col-span-2 text-xs">{{ formatDate(importMetadata()!.authorizedDate!) }}</span>
                </div>
              }
              @if (importMetadata()!.postedDate) {
                <div class="grid grid-cols-3 gap-2">
                  <span class="text-muted-foreground text-xs">Posted Date</span>
                  <span class="col-span-2 text-xs">{{ formatDate(importMetadata()!.postedDate!) }}</span>
                </div>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class TransactionImportMetadataComponent {
  private readonly currencyService = inject(CurrencyService);

  importMetadata = input<{
    provider: 'plaid' | 'financekit';
    originalStatement?: string;
    merchantName?: string;
    date: string;
    postedDate?: string;
    amount: bigint;
    authorizedDate?: string;
    // Deprecated field
    name?: string;
  } | null>();

  isExpanded = signal(false);

  // Computed values
  originalStatementText = computed(() => {
    const metadata = this.importMetadata();
    if (!metadata) return null;
    return metadata.originalStatement ?? metadata.name ?? null;
  });

  // Nucleo icons
  ChevronDown = ChevronDown;
  ChevronUp = ChevronUp;
  FileText = FileText;

  toggleExpanded() {
    this.isExpanded.update((v) => !v);
  }

  formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatAmount(amount: bigint): string {
    return this.currencyService.format(amount);
  }
}
