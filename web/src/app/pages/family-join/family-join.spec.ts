import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { ConvexService } from '../../services/convex.service';
import { FamilyJoinComponent } from './family-join';

vi.mock('ngx-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

type FamilyGroupInvitePreview = FunctionReturnType<typeof api.familyGroups.getInvitePreview>;

function createInvitePreview(overrides: Partial<FamilyGroupInvitePreview> = {}): FamilyGroupInvitePreview {
  return {
    status: 'available',
    canAccept: true,
    familyGroupName: 'Igor Family',
    invitedByName: 'Igor',
    expiresAt: '2026-06-24T12:00:00.000Z',
    currentFamilyGroup: null,
    ...overrides,
  };
}

describe('FamilyJoinComponent', () => {
  let fixture: ComponentFixture<FamilyJoinComponent>;
  let querySpy: ReturnType<typeof vi.fn>;
  let mutationSpy: ReturnType<typeof vi.fn>;
  let navigateByUrlSpy: ReturnType<typeof vi.fn>;

  async function createComponent(preview: FamilyGroupInvitePreview): Promise<void> {
    querySpy = vi.fn().mockResolvedValue(preview);
    mutationSpy = vi.fn().mockResolvedValue({
      accepted: true,
      familyGroupId: 'family_group_1' as Id<'familyGroup'>,
      memberId: 'family_group_member_1' as Id<'familyGroupMember'>,
      previousFamilyDeleted: false,
      alreadyMember: false,
    });
    navigateByUrlSpy = vi.fn().mockResolvedValue(true);

    const mockConvexService = {
      isAuthenticated: vi.fn().mockReturnValue(true),
      getClient: vi.fn().mockReturnValue({
        query: querySpy,
      }),
      mutation: mutationSpy,
    } as unknown as ConvexService;

    const mockAuthService = {
      user: signal({ email: 'signedin@example.com' }),
      logout: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthService;

    await TestBed.configureTestingModule({
      imports: [FamilyJoinComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: mockConvexService },
        { provide: AuthService, useValue: mockAuthService },
        {
          provide: Router,
          useValue: {
            navigateByUrl: navigateByUrlSpy,
          },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ token: 'invite-token' }),
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FamilyJoinComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(querySpy).toHaveBeenCalledWith(api.familyGroups.getInvitePreview, {
        inviteToken: 'invite-token',
      });
    });
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows invite details and the accept action for an available invite', async () => {
    await createComponent(createInvitePreview());

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Join Igor Family');
    });

    expect(fixture.nativeElement.textContent).toContain('Igor invited you to join Igor Family');
    expect(fixture.nativeElement.textContent).not.toContain('casey@example.com');
    expect(fixture.nativeElement.querySelector('[data-testid="accept-family-invite"]')).not.toBeNull();
  });

  it('does not disclose invitee or signed-in emails for wrong-account invites', async () => {
    await createComponent(
      createInvitePreview({
        status: 'email_mismatch',
        canAccept: false,
      })
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Use the invited email');
    });

    expect(fixture.nativeElement.textContent).toContain('This invite is for a different account');
    expect(fixture.nativeElement.textContent).not.toContain('casey@example.com');
    expect(fixture.nativeElement.querySelector('[data-testid="accept-family-invite"]')).toBeNull();
  });

  it('explains when the user must leave their current family first', async () => {
    await createComponent(
      createInvitePreview({
        status: 'must_leave_current_family',
        canAccept: false,
        currentFamilyGroup: {
          name: 'Current Family',
          role: 'member',
          activeMemberCount: 2,
          otherActiveMemberCount: 1,
        },
      })
    );

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('Leave current family first');
    });

    expect(fixture.nativeElement.textContent).toContain('Current Family');
    expect(fixture.nativeElement.querySelector('[data-testid="accept-family-invite"]')).toBeNull();
  });

  it('accepts the invite and navigates to workspaces', async () => {
    await createComponent(createInvitePreview());

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="accept-family-invite"]')).not.toBeNull();
    });

    const acceptButton = fixture.nativeElement.querySelector(
      '[data-testid="accept-family-invite"]'
    ) as HTMLButtonElement;
    acceptButton.click();

    await vi.waitFor(() => {
      expect(mutationSpy).toHaveBeenCalledWith(api.familyGroups.acceptInvite, {
        inviteToken: 'invite-token',
      });
      expect(navigateByUrlSpy).toHaveBeenCalledWith('/workspaces');
    });
  });
});
