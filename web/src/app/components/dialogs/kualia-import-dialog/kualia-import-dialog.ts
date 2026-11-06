import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogService, HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { readExportArchive, type ArchiveFile } from 'convex/dataExports/archive';
import { MAX_EXPORT_BYTES, readExportTables } from 'convex/kualiaImport/csv';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { getShortId } from '../../../shared/utils/id-utils';
import { CurrencySelectorComponent } from '../../currency-selector/currency-selector.component';

export function openKualiaImport(dialog: HlmDialogService) {
  const ref = dialog.open(KualiaImportDialogComponent, {
    context: { close: () => ref.close() },
    ariaLabel: 'Import from Kualia',
    closeOnBackdropClick: false,
    disableClose: true,
    showCloseButton: false,
    contentClass: 'w-full sm:w-lg',
  });
}

@Component({
  selector: 'app-kualia-import-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmDialogFooter, HlmDialogHeader, HlmInput, CurrencySelectorComponent],
  templateUrl: './kualia-import-dialog.html',
})
export class KualiaImportDialogComponent {
  protected readonly dialog = injectBrnDialogContext<{ close: () => void }>();
  private readonly convex = inject(ConvexService);
  private readonly router = inject(Router);
  protected readonly name = signal('Imported budget');
  protected readonly currency = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly reading = signal(false);
  protected readonly preview = signal<{
    accounts: number;
    categories: number;
    transactions: number;
    months: number;
  } | null>(null);
  private files: ArchiveFile[] = [];
  private requestId = '';

  protected async selectFiles(selected: FileList | null) {
    if (this.busy() || this.reading() || !selected?.length) return;
    this.error.set('');
    this.preview.set(null);
    this.files = [];
    this.reading.set(true);
    try {
      const input = Array.from(selected);
      if (input.reduce((n, file) => n + file.size, 0) > MAX_EXPORT_BYTES)
        throw new Error('Choose an export of 8 MiB or less.');
      if (input.some((file) => /\.zip$/i.test(file.name)) && input.length !== 1)
        throw new Error('Select the ZIP by itself, or select all four CSV files together.');
      const files =
        input.length === 1 && /\.zip$/i.test(input[0].name)
          ? readExportArchive(await input[0].arrayBuffer())
          : await Promise.all(input.map(async (file) => ({ name: file.name, content: await file.text() })));
      const tables = readExportTables(files);
      this.files = files;
      this.requestId = crypto.randomUUID();
      this.preview.set({
        accounts: tables.accounts.length,
        categories: tables.categories.length,
        transactions: new Set(tables.transactions.map((r) => r.transaction_id)).size,
        months: new Set(tables.plan.map((r) => r.year_month)).size,
      });
    } catch (error: unknown) {
      this.error.set(extractConvexErrorMessage(error, 'Could not read this Kualia export.'));
    } finally {
      this.reading.set(false);
    }
  }

  protected async restore() {
    if (this.busy() || !this.preview() || !this.name().trim() || !this.currency()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const workspaceId = await this.convex.action<Id<'workspace'>>(api.kualiaImport.restore, {
        files: this.files,
        name: this.name().trim(),
        currency: this.currency(),
        requestId: this.requestId,
      });
      this.dialog.close();
      toast.success(`Imported “${this.name().trim()}”.`);
      await this.router.navigate([getShortId(workspaceId), 'transactions']);
    } catch (error: unknown) {
      this.error.set(extractConvexErrorMessage(error, 'Could not finish the import. Please try again.'));
    } finally {
      this.busy.set(false);
    }
  }
}
