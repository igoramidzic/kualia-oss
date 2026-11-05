import { DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { api } from 'convex/_generated/api';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { InviteFamilyMemberDialogComponent } from './invite-family-member-dialog';

function createConvexActionFailure(data: string, message = data): ConvexError<string> {
  const error = new ConvexError(`[CONVEX A(familyGroups:createInvite)] Uncaught ConvexError: ${message}
  Called by client`);
  error.data = data;
  return error;
}

describe('InviteFamilyMemberDialogComponent', () => {
  let fixture: ComponentFixture<InviteFamilyMemberDialogComponent>;
  let actionSpy: ReturnType<typeof vi.fn>;
  let onCloseSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    actionSpy = vi.fn().mockResolvedValue(undefined);
    onCloseSpy = vi.fn();

    const mockConvexService = {
      action: actionSpy,
    } as unknown as ConvexService;

    await TestBed.configureTestingModule({
      imports: [InviteFamilyMemberDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: mockConvexService },
        { provide: DIALOG_DATA, useValue: { onClose: onCloseSpy } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteFamilyMemberDialogComponent);
    fixture.detectChanges();
  });

  it('shows the ConvexError data when an invite fails', async () => {
    actionSpy.mockRejectedValue(createConvexActionFailure("You can't invite yourself to your family group"));

    const nameInput = fixture.nativeElement.querySelector('#invitee-name') as HTMLInputElement;
    const emailInput = fixture.nativeElement.querySelector('#invitee-email') as HTMLInputElement;
    const submitButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;

    nameInput.value = 'Igor';
    nameInput.dispatchEvent(new Event('input'));
    emailInput.value = 'igor@kualia.com';
    emailInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submitButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain("You can't invite yourself to your family group");
    });
    expect(fixture.nativeElement.textContent).not.toContain('[CONVEX A(familyGroups:createInvite)]');
    expect(fixture.nativeElement.textContent).not.toContain('Uncaught ConvexError');
    expect(fixture.nativeElement.textContent).not.toContain('Called by client');
  });

  it('keeps the dialog open and surfaces email delivery failures', async () => {
    actionSpy.mockRejectedValue(
      createConvexActionFailure('Failed to send invite. Please try again.', 'No sending domain configured')
    );

    const nameInput = fixture.nativeElement.querySelector('#invitee-name') as HTMLInputElement;
    const emailInput = fixture.nativeElement.querySelector('#invitee-email') as HTMLInputElement;
    const submitButton = fixture.nativeElement.querySelector('button[type="submit"]') as HTMLButtonElement;

    nameInput.value = 'Casey';
    nameInput.dispatchEvent(new Event('input'));
    emailInput.value = 'casey@example.com';
    emailInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    submitButton.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Failed to send invite. Please try again.');
    });
    expect(fixture.nativeElement.textContent).not.toContain('No sending domain configured');
    expect(actionSpy).toHaveBeenCalledWith(api.familyGroups.createInvite, {
      invitedName: 'Casey',
      invitedEmail: 'casey@example.com',
    });
    expect(onCloseSpy).not.toHaveBeenCalled();
  });
});
