import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BrnDialogRef } from '@spartan-ng/brain/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../services/auth.service';
import { ConvexService } from '../../../services/convex.service';
import { DeleteAccountDialogComponent } from './delete-account-dialog';

describe('DeleteAccountDialogComponent', () => {
  let fixture: ComponentFixture<DeleteAccountDialogComponent>;
  let action: ReturnType<typeof vi.fn>;
  let logout: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    action = vi.fn().mockResolvedValue({ success: true });
    logout = vi.fn().mockResolvedValue(undefined);
    close = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DeleteAccountDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: { action } },
        { provide: AuthService, useValue: { logout } },
        { provide: BrnDialogRef, useValue: { close } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DeleteAccountDialogComponent);
    fixture.detectChanges();
  });

  function confirmationInput(): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="delete-account-confirmation-input"]');
  }

  function deleteButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('[data-testid="delete-account-confirm-button"]');
  }

  it('keeps deletion disabled until the exact confirmation is typed', () => {
    const input = confirmationInput();
    expect(deleteButton().disabled).toBe(true);

    input.value = 'delete';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(deleteButton().disabled).toBe(true);

    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(deleteButton().disabled).toBe(false);
  });

  it('explains the web and App Store subscription cancellation boundary', () => {
    const notice: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="delete-account-subscription-notice"]'
    );

    expect(notice.textContent).toContain('stop renewal of a web trial or subscription');
    expect(notice.textContent).toContain('cancel separately in Apple Subscriptions');
  });

  it('deletes the account and logs out after confirmation', async () => {
    const input = confirmationInput();
    input.value = 'DELETE';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    deleteButton().click();

    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledWith(true);
    expect(logout).toHaveBeenCalledOnce();
  });
});
