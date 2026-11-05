import { DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { FunctionReturnType } from 'convex/server';
import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteFamilyMemberDialogComponent } from '../../../components/dialogs/invite-family-member-dialog/invite-family-member-dialog';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { FamilyComponent, LeaveFamilyGroupDialogComponent } from './family';

type FamilyGroup = FunctionReturnType<typeof api.familyGroups.getMine>;
type FamilyGroupView = NonNullable<FamilyGroup>;
type FamilyGroupMember = FamilyGroupView['members'][number];
type FamilyGroupInvite = FamilyGroupView['pendingInvites'][number];

function createMember(overrides: Partial<FamilyGroupMember> = {}): FamilyGroupMember {
  return {
    _id: 'family_group_member_1' as Id<'familyGroupMember'>,
    clerkId: 'clerk_owner',
    name: 'Igor',
    email: 'igor@kualia.com',
    role: 'owner',
    isCurrentUser: true,
    joinedAt: '2026-06-10T12:00:00.000Z',
    ...overrides,
  };
}

function createInvite(overrides: Partial<FamilyGroupInvite> = {}): FamilyGroupInvite {
  return {
    _id: 'family_group_invite_1' as Id<'familyGroupInvite'>,
    invitedEmail: 'casey@example.com',
    invitedName: 'Casey',
    invitedByName: 'Igor',
    status: 'pending',
    createdAt: '2026-06-10T12:00:00.000Z',
    lastSentAt: '2026-06-10T12:00:00.000Z',
    expiresAt: '2026-06-24T12:00:00.000Z',
    ...overrides,
  };
}

function createFamilyGroup(overrides: Partial<FamilyGroupView> = {}): FamilyGroupView {
  return {
    _id: 'family_group_1' as Id<'familyGroup'>,
    name: 'Igor Family',
    ownerClerkId: 'clerk_owner',
    currentUserRole: 'owner',
    members: [createMember()],
    pendingInvites: [],
    inviteEmailQuota: {
      limit: 10,
      used: 0,
      remaining: 10,
      windowStartedAt: null,
      windowEndsAt: null,
    },
    ...overrides,
  };
}

describe('FamilyComponent', () => {
  let fixture: ComponentFixture<FamilyComponent>;
  let familyGroupSignal: ReturnType<typeof signal<FamilyGroup | undefined>>;
  let mutationSpy: ReturnType<typeof vi.fn>;
  let openDialogSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    familyGroupSignal = signal<FamilyGroup | undefined>(null);
    mutationSpy = vi.fn().mockResolvedValue('family_group_1');
    openDialogSpy = vi.fn().mockReturnValue({ close: vi.fn() });

    const mockConvexService = {
      query: vi.fn().mockReturnValue(familyGroupSignal.asReadonly()),
      mutation: mutationSpy,
    } as unknown as ConvexService;

    const mockDialogService = {
      open: openDialogSpy,
    } as unknown as HlmDialogService;

    const mockWorkspaceService = {
      workspace: signal({ name: 'Personal' }),
      workspaceShortId: signal('personal'),
    } as unknown as WorkspaceService;

    const mockSidebarService = {
      toggleSidebar: vi.fn(),
      setOpenMobile: vi.fn(),
    } as unknown as HlmSidebarService;

    await TestBed.configureTestingModule({
      imports: [FamilyComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ConvexService, useValue: mockConvexService },
        { provide: HlmDialogService, useValue: mockDialogService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: HlmSidebarService, useValue: mockSidebarService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FamilyComponent);
  });

  it('renders nothing for the family data while the family group query is loading', () => {
    familyGroupSignal.set(undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Loading family group');
    expect(fixture.nativeElement.querySelector('[data-testid="create-family-group"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('.fade-in')).toBeNull();

    familyGroupSignal.set(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.fade-in')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="create-family-group"]')).not.toBeNull();
  });

  it('shows the create group action when the user has no family group', () => {
    familyGroupSignal.set(null);
    fixture.detectChanges();

    const createButton = fixture.nativeElement.querySelector('[data-testid="create-family-group"]');
    const betaBadge = fixture.nativeElement.querySelector('[data-testid="family-beta-badge"]');
    expect(createButton).not.toBeNull();
    expect(betaBadge).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Create a family group before inviting people');
    expect(fixture.nativeElement.textContent).toContain(
      "Everyone in a family can see each other's workspaces and budgets"
    );
  });

  it('creates a family group from the empty state', async () => {
    familyGroupSignal.set(null);
    fixture.detectChanges();

    const createButton = fixture.nativeElement.querySelector(
      '[data-testid="create-family-group"]'
    ) as HTMLButtonElement;
    createButton.click();

    await vi.waitFor(() => {
      expect(mutationSpy).toHaveBeenCalledWith(api.familyGroups.createGroup, {});
    });
  });

  it('shows invite capacity based on members and pending invites', () => {
    familyGroupSignal.set(
      createFamilyGroup({
        members: [
          createMember(),
          createMember({
            _id: 'family_group_member_2' as Id<'familyGroupMember'>,
            clerkId: 'clerk_member',
            name: 'Morgan',
            email: 'morgan@example.com',
            role: 'member',
            isCurrentUser: false,
          }),
        ],
        pendingInvites: [createInvite()],
      })
    );

    fixture.detectChanges();

    const pageHeading = fixture.nativeElement.querySelector('[data-testid="together-page-heading"]');
    const membersHeading = fixture.nativeElement.querySelector('[data-testid="members-section-heading"]');
    const remaining = fixture.nativeElement.querySelector('[data-testid="invites-remaining"]');
    expect(pageHeading?.textContent).not.toContain('3/5 invites remaining');
    expect(membersHeading?.textContent).toContain('Members');
    expect(membersHeading?.textContent).toContain('3/5 invites remaining');
    expect(remaining?.textContent).toContain('3/5 invites remaining');
  });

  it('opens the invite dialog from the invite button', () => {
    familyGroupSignal.set(createFamilyGroup());
    fixture.detectChanges();

    const inviteButton = fixture.nativeElement.querySelector('[data-testid="invite-member"]') as HTMLButtonElement;
    inviteButton.click();

    expect(openDialogSpy).toHaveBeenCalledWith(
      InviteFamilyMemberDialogComponent,
      expect.objectContaining({
        contentClass: 'max-w-full sm:w-md',
        context: expect.objectContaining({
          onClose: expect.any(Function),
        }),
      })
    );
  });

  it('shows the leave action when the current user is a member', () => {
    familyGroupSignal.set(
      createFamilyGroup({
        currentUserRole: 'member',
        inviteEmailQuota: null,
        members: [
          createMember({ isCurrentUser: false }),
          createMember({
            _id: 'family_group_member_2' as Id<'familyGroupMember'>,
            clerkId: 'clerk_member',
            name: 'Morgan',
            email: 'morgan@example.com',
            role: 'member',
            isCurrentUser: true,
          }),
        ],
      })
    );
    fixture.detectChanges();

    const leaveButton = fixture.nativeElement.querySelector('[data-testid="leave-family-group"]');

    expect(leaveButton).not.toBeNull();
    expect(leaveButton?.textContent).toContain('Leave Family');
    expect(fixture.nativeElement.querySelector('[data-testid="invite-member"]')).toBeNull();
  });

  it('opens the leave confirmation from the member action', () => {
    familyGroupSignal.set(
      createFamilyGroup({
        currentUserRole: 'member',
        inviteEmailQuota: null,
        members: [
          createMember({ isCurrentUser: false }),
          createMember({
            _id: 'family_group_member_2' as Id<'familyGroupMember'>,
            clerkId: 'clerk_member',
            name: 'Morgan',
            email: 'morgan@example.com',
            role: 'member',
            isCurrentUser: true,
          }),
        ],
      })
    );
    fixture.detectChanges();

    const leaveButton = fixture.nativeElement.querySelector('[data-testid="leave-family-group"]') as HTMLButtonElement;
    leaveButton.click();

    expect(openDialogSpy).toHaveBeenCalledWith(
      LeaveFamilyGroupDialogComponent,
      expect.objectContaining({
        closeOnBackdropClick: false,
        contentClass: 'max-w-full sm:w-md',
        context: expect.objectContaining({
          onClose: expect.any(Function),
        }),
      })
    );
    expect(mutationSpy).not.toHaveBeenCalledWith(api.familyGroups.leaveGroup, {});
  });

  it('disables inviting and shows the quota reset date when invite email quota is exhausted', () => {
    familyGroupSignal.set(
      createFamilyGroup({
        inviteEmailQuota: {
          limit: 10,
          used: 10,
          remaining: 0,
          windowStartedAt: '2026-06-01T12:00:00.000Z',
          windowEndsAt: '2026-07-01T12:00:00.000Z',
        },
      })
    );
    fixture.detectChanges();

    const inviteButton = fixture.nativeElement.querySelector('[data-testid="invite-member"]') as HTMLButtonElement;
    const quotaMessage = fixture.nativeElement.querySelector('[data-testid="invite-email-quota-message"]');

    expect(inviteButton.disabled).toBe(true);
    expect(quotaMessage?.textContent).toContain('Invite email limit reached. Try again after 2026-07-01.');
    expect(openDialogSpy).not.toHaveBeenCalled();
  });

  it('places the invite action in the page heading', () => {
    familyGroupSignal.set(createFamilyGroup());
    fixture.detectChanges();

    const heading = fixture.nativeElement.querySelector('[data-testid="together-page-heading"]');
    const betaBadge = fixture.nativeElement.querySelector('[data-testid="family-beta-badge"]');
    expect(heading?.textContent).toContain('Family');
    expect(betaBadge?.textContent).toContain('Beta');
    expect(betaBadge?.classList.contains('bg-white')).toBe(true);
    expect(betaBadge?.classList.contains('text-black')).toBe(true);
    expect(betaBadge?.classList.contains('uppercase')).toBe(true);
    expect(heading?.textContent).toContain('Invite Member');
    expect(heading?.textContent).toContain("Everyone in your family can see each other's workspaces and budgets");
    expect(heading?.textContent).not.toContain('stay private until you choose otherwise');
  });

  it('renders members and pending invites as links to details pages', () => {
    const memberId = 'family_group_member_2' as Id<'familyGroupMember'>;
    const inviteId = 'family_group_invite_2' as Id<'familyGroupInvite'>;

    familyGroupSignal.set(
      createFamilyGroup({
        members: [
          createMember(),
          createMember({
            _id: memberId,
            clerkId: 'clerk_member',
            name: 'Morgan',
            email: 'morgan@example.com',
            role: 'member',
            isCurrentUser: false,
          }),
        ],
        pendingInvites: [createInvite({ _id: inviteId })],
      })
    );
    fixture.detectChanges();

    const memberLink = fixture.nativeElement.querySelector(`[data-testid="family-member-${memberId}"]`);
    const inviteLink = fixture.nativeElement.querySelector(`[data-testid="family-invite-${inviteId}"]`);

    expect(memberLink?.tagName).toBe('A');
    expect(inviteLink?.tagName).toBe('A');
  });
});

describe('LeaveFamilyGroupDialogComponent', () => {
  let fixture: ComponentFixture<LeaveFamilyGroupDialogComponent>;
  let mutationSpy: ReturnType<typeof vi.fn>;
  let onCloseSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mutationSpy = vi.fn().mockResolvedValue({ left: true, familyGroupDeleted: false });
    onCloseSpy = vi.fn();

    const mockConvexService = {
      mutation: mutationSpy,
    } as unknown as ConvexService;

    await TestBed.configureTestingModule({
      imports: [LeaveFamilyGroupDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: mockConvexService },
        { provide: DIALOG_DATA, useValue: { onClose: onCloseSpy } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LeaveFamilyGroupDialogComponent);
  });

  it('explains what happens before leaving', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Leaving removes your access');
    expect(fixture.nativeElement.textContent).toContain('Your personal Kualia account stays intact');
    expect(fixture.nativeElement.textContent).toContain('family manager will need to invite you again');
  });

  it('cancels without leaving', () => {
    fixture.detectChanges();

    const cancelButton = fixture.nativeElement.querySelector(
      '[data-testid="cancel-leave-family"]'
    ) as HTMLButtonElement;
    cancelButton.click();

    expect(onCloseSpy).toHaveBeenCalledWith(false);
    expect(mutationSpy).not.toHaveBeenCalled();
  });

  it('confirms leaving the family group', async () => {
    fixture.detectChanges();

    const confirmButton = fixture.nativeElement.querySelector(
      '[data-testid="confirm-leave-family"]'
    ) as HTMLButtonElement;
    confirmButton.click();

    await vi.waitFor(() => {
      expect(mutationSpy).toHaveBeenCalledWith(api.familyGroups.leaveGroup, {});
      expect(onCloseSpy).toHaveBeenCalledWith(true);
    });
  });

  it('shows an error when leaving fails', async () => {
    mutationSpy.mockRejectedValueOnce(new ConvexError('Leave failed'));
    fixture.detectChanges();

    const confirmButton = fixture.nativeElement.querySelector(
      '[data-testid="confirm-leave-family"]'
    ) as HTMLButtonElement;
    confirmButton.click();

    await vi.waitFor(() => {
      expect(fixture.nativeElement.textContent).toContain('Leave failed');
      expect(onCloseSpy).not.toHaveBeenCalled();
    });
  });
});
