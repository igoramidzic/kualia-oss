import { DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { createZipArchive } from 'convex/dataExports/archive';
import { EXPORT_COLUMNS } from 'convex/dataExports/columns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { CurrencySelectorComponent } from '../../currency-selector/currency-selector.component';
import { KualiaImportDialogComponent } from './kualia-import-dialog';

describe('Kualia workspace import dialog', () => {
  let fixture: ComponentFixture<KualiaImportDialogComponent>;
  const restore = vi.fn(),
    navigate = vi.fn(),
    close = vi.fn();
  const files = Object.entries(EXPORT_COLUMNS).map(([name, columns]) => ({
    name,
    content: '\uFEFF' + columns.join(',') + '\r\n',
  }));
  const zip = createZipArchive(files);
  const upload = async (selected: File[]) => {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="file"]');
    Object.defineProperty(input, 'files', { configurable: true, value: selected });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain('Reading export');
    });
  };
  const submit = (): HTMLButtonElement => fixture.nativeElement.querySelector('hlm-dialog-footer button:last-child');

  beforeEach(async () => {
    vi.resetAllMocks();
    TestBed.configureTestingModule({
      imports: [KualiaImportDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: DIALOG_DATA, useValue: { close } },
        { provide: ConvexService, useValue: { action: restore } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    fixture = TestBed.createComponent(KualiaImportDialogComponent);
    fixture.detectChanges();
  });

  it('previews a ZIP and requires an explicit currency before creating the workspace', async () => {
    await upload([new File([Uint8Array.from(zip).buffer], 'original.zip')]);
    expect(fixture.nativeElement.textContent).toContain('0 transactions');
    expect(submit().disabled).toBe(true);
    expect(restore).not.toHaveBeenCalled();
    const selector = fixture.debugElement.query(By.directive(CurrencySelectorComponent))
      .componentInstance as CurrencySelectorComponent;
    selector.currencyChange.emit('EUR');
    fixture.detectChanges();
    restore.mockResolvedValue('workspace_12345678');
    submit().click();
    await fixture.whenStable();
    expect(restore).toHaveBeenCalledOnce();
    expect(restore.mock.calls[0][1]).toMatchObject({
      currency: 'EUR',
      name: 'Imported budget',
      files: files.map((f) => ({ ...f, content: f.content.slice(1) })),
    });
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['12345678', 'transactions']);
  });
  it('clears the previous selection and explains which CSV is missing', async () => {
    await upload(files.map((f) => new File([f.content], f.name)));
    expect(fixture.nativeElement.textContent).toContain('0 accounts');
    await upload([new File([files[0].content], files[0].name)]);
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('bank-accounts.csv');
    expect(submit().disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('#kualia-name')).toBeNull();
  });
});
