import { effect, inject, Injectable, signal } from '@angular/core';
import { api } from '../../../../convex/_generated/api';
import { ConvexService } from './convex.service';

export interface AccountTypeMapping {
  accountName: string;
  inferredType: string | null;
  confirmedType: string | null;
}

export interface ImportPreview {
  accountCount: number;
  monthCount: number;
  categoryCount: number;
  transactionCount: number;
}

export interface ImportProgress {
  currentStep: string;
  accountsTotal: number;
  accountsImported: number;
  categoriesTotal: number;
  categoriesImported: number;
  transactionsTotal: number;
  transactionsImported: number;
}

export interface ImportStatus {
  status: 'pending' | 'parsing' | 'importing' | 'completed' | 'failed';
  errorMessage?: string;
  progress?: ImportProgress;
  workspaceId?: string;
  createdAt?: string;
  updatedAt?: string;
}

type ParseResult =
  | {
      success: false;
      error: string;
    }
  | {
      success: true;
      accountMappings: AccountTypeMapping[];
      preview: ImportPreview;
    };

type StartImportResult = { success: true } | { success: false; error: string };

function getCurrentLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeYnabRegisterDateSeparators(registerCsv: string): string {
  const lines = registerCsv.split('\n');

  return lines
    .map((line, index) => {
      // Header row or empty line
      if (index === 0 || !line.trim()) {
        return line;
      }

      // Replace date in the 3rd CSV field only when formatted as DD-MM-YYYY or MM-DD-YYYY.
      // Keep YYYY-MM-DD untouched.
      return line.replace(
        /^((?:"(?:[^"]|"")*",){2}")(\d{2})-(\d{2})-(\d{4})"/u,
        (_, prefix: string, first: string, second: string, year: string) => `${prefix}${first}/${second}/${year}"`
      );
    })
    .join('\n');
}

function getRegisterDateSamples(registerCsv: string, maxSamples = 5): string[] {
  const lines = registerCsv.split('\n');
  const samples: string[] = [];

  for (let i = 1; i < lines.length && samples.length < maxSamples; i++) {
    const line = lines[i];
    if (!line.trim()) {
      continue;
    }

    const match = /^((?:"(?:[^"]|"")*",){2})"([^"]*)"/u.exec(line);
    if (match?.[2]) {
      samples.push(match[2]);
    }
  }

  return samples;
}

function countDashedDateFields(registerCsv: string): number {
  const matches = registerCsv.match(/^(?:"(?:[^"]|"")*",){2}"\d{2}-\d{2}-\d{4}"/gmu);
  return matches?.length ?? 0;
}

@Injectable({
  providedIn: 'root',
})
export class YnabImportService {
  private readonly convexService = inject(ConvexService);

  // State signals
  private readonly _planCsvContent = signal<string | null>(null);
  private readonly _registerCsvContent = signal<string | null>(null);
  private readonly _accountMappings = signal<AccountTypeMapping[]>([]);
  private readonly _preview = signal<ImportPreview | null>(null);
  private readonly _workspaceName = signal<string>('YNAB Import');
  private readonly _currency = signal<string>('USD');
  private readonly _parsing = signal(false);
  private readonly _importing = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _importStatus = signal<ImportStatus | null>(null);

  // Subscription cleanup
  private statusSubscription?: () => void;

  // Public readonly signals
  readonly planCsvContent = this._planCsvContent.asReadonly();
  readonly registerCsvContent = this._registerCsvContent.asReadonly();
  readonly accountMappings = this._accountMappings.asReadonly();
  readonly preview = this._preview.asReadonly();
  readonly workspaceName = this._workspaceName.asReadonly();
  readonly currency = this._currency.asReadonly();
  readonly parsing = this._parsing.asReadonly();
  readonly importing = this._importing.asReadonly();
  readonly error = this._error.asReadonly();
  readonly importStatus = this._importStatus.asReadonly();

  constructor() {
    // Subscribe to import status when authenticated
    effect(() => {
      if (this.convexService.isAuthenticated()) {
        this.startWatchingImportStatus();
      } else {
        this.stopWatchingImportStatus();
      }
    });
  }

  private startWatchingImportStatus(): void {
    if (this.statusSubscription) {
      return;
    }

    const watcher = this.convexService.watchQuery<ImportStatus | null>(api.ynab.getYnabImportStatus, {});

    this.statusSubscription = watcher.subscribe((data) => {
      this._importStatus.set(data ?? null);
    });
  }

  private stopWatchingImportStatus(): void {
    if (this.statusSubscription) {
      this.statusSubscription();
      this.statusSubscription = undefined;
    }
  }

  // Set CSV file contents
  setPlanCsv(content: string): void {
    this._planCsvContent.set(content);
    this._error.set(null);
  }

  setRegisterCsv(content: string): void {
    this._registerCsvContent.set(content);
    this._error.set(null);
  }

  setWorkspaceName(name: string): void {
    this._workspaceName.set(name);
  }

  setCurrency(currency: string): void {
    this._currency.set(currency);
  }

  // Update a single account type mapping
  updateAccountType(accountName: string, accountType: string): void {
    this._accountMappings.update((mappings) =>
      mappings.map((m) => (m.accountName === accountName ? { ...m, confirmedType: accountType } : m))
    );
  }

  // Parse the CSV files
  async parseFiles(): Promise<boolean> {
    const planCsv = this._planCsvContent();
    const registerCsv = this._registerCsvContent();

    if (!planCsv || !registerCsv) {
      this._error.set('Please upload both plan.csv and register.csv files');
      return false;
    }

    this._parsing.set(true);
    this._error.set(null);

    try {
      const dashedCountBefore = countDashedDateFields(registerCsv);
      const normalizedRegisterCsv = normalizeYnabRegisterDateSeparators(registerCsv);
      const dashedCountAfter = countDashedDateFields(normalizedRegisterCsv);
      console.log('[YNAB Import] parseFiles register date normalization', {
        dashedCountBefore,
        dashedCountAfter,
        sampleDatesBefore: getRegisterDateSamples(registerCsv),
        sampleDatesAfter: getRegisterDateSamples(normalizedRegisterCsv),
      });

      const result = await this.convexService.action<ParseResult>(api.ynab.parseYnabFiles, {
        planCsvContent: planCsv,
        registerCsvContent: normalizedRegisterCsv,
        currency: this._currency(),
      });

      if (!result.success) {
        this._error.set(result.error);
        return false;
      }

      this._accountMappings.set(result.accountMappings);
      this._preview.set(result.preview);
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to parse files';
      this._error.set(message);
      return false;
    } finally {
      this._parsing.set(false);
    }
  }

  // Start the import (schedules import asynchronously and returns immediately)
  async startImport(): Promise<boolean> {
    const planCsv = this._planCsvContent();
    const registerCsv = this._registerCsvContent();
    const mappings = this._accountMappings();

    if (!planCsv || !registerCsv) {
      this._error.set('CSV files not loaded');
      return false;
    }

    if (mappings.length === 0) {
      this._error.set('No account mappings available');
      return false;
    }

    this._importing.set(true);
    this._error.set(null);

    try {
      const dashedCountBefore = countDashedDateFields(registerCsv);
      const normalizedRegisterCsv = normalizeYnabRegisterDateSeparators(registerCsv);
      const dashedCountAfter = countDashedDateFields(normalizedRegisterCsv);
      console.log('[YNAB Import] startImport register date normalization', {
        dashedCountBefore,
        dashedCountAfter,
        sampleDatesBefore: getRegisterDateSamples(registerCsv),
        sampleDatesAfter: getRegisterDateSamples(normalizedRegisterCsv),
      });
      const accountTypeMappings = mappings.map((m) => ({
        accountName: m.accountName,
        accountType: m.confirmedType,
      }));

      const result = await this.convexService.action<StartImportResult>(api.ynab.startYnabImport, {
        planCsvContent: planCsv,
        registerCsvContent: normalizedRegisterCsv,
        accountTypeMappings,
        workspaceName: this._workspaceName(),
        currency: this._currency(),
        currentDate: getCurrentLocalDate(),
      });

      if (!result.success) {
        this._error.set(result.error);
        return false;
      }

      // Import has been scheduled - the UI should transition to the Importing step
      // and subscribe to importStatus for progress updates
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to start import';
      this._error.set(message);
      return false;
    } finally {
      this._importing.set(false);
    }
  }

  // Reset state for a new import
  reset(): void {
    this._planCsvContent.set(null);
    this._registerCsvContent.set(null);
    this._accountMappings.set([]);
    this._preview.set(null);
    this._workspaceName.set('YNAB Import');
    this._currency.set('USD');
    this._error.set(null);
    this._parsing.set(false);
    this._importing.set(false);
  }
}
