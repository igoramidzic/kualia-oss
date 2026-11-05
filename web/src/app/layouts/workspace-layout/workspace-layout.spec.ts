import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { MerchantService } from '../../services/merchant.service';
import { type CreateTransactionDialogContext, TransactionService } from '../../services/transaction.service';
import { WorkspaceService } from '../../services/workspace.service';
import { WorkspaceLayoutComponent } from './workspace-layout';

describe('WorkspaceLayoutComponent', () => {
  it('forwards an initial transaction date to the create dialog', async () => {
    let transactionDialogOpener: ((context?: CreateTransactionDialogContext) => void) | undefined;
    const dialogService = {
      open: vi.fn(() => ({ closed$: new Subject<unknown>() })),
    };

    await TestBed.configureTestingModule({
      imports: [WorkspaceLayoutComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: HlmDialogService, useValue: dialogService },
        { provide: MerchantService, useValue: { setDialogOpener: vi.fn() } },
        {
          provide: TransactionService,
          useValue: {
            setDialogOpener: (opener: (context?: CreateTransactionDialogContext) => void) => {
              transactionDialogOpener = opener;
            },
          },
        },
        { provide: WorkspaceService, useValue: { workspaceShortId: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(WorkspaceLayoutComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    transactionDialogOpener?.({ initialDate: '2026-06-15' });

    const workspaceLayoutElement = fixture.nativeElement as HTMLElement;
    expect(workspaceLayoutElement.classList.contains('contents')).toBe(true);
    expect(dialogService.open).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        context: expect.objectContaining({ initialDate: '2026-06-15' }),
      })
    );
  });
});
