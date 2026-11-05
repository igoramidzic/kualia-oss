import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../../services/convex.service';
import { WorkspaceService } from '../../../../services/workspace.service';
import { FamilyGroupMemberDetails, FamilyMemberComponent, RemoveFamilyMemberDialogComponent } from './family-member';

type JoinedMemberDetails = Extract<FamilyGroupMemberDetails, { kind: 'member' }>;
type InvitedMemberDetails = Extract<FamilyGroupMemberDetails, { kind: 'invite' }>;

function createJoinedMember(overrides: Partial<JoinedMemberDetails> = {}): JoinedMemberDetails {
  return {
    kind: 'member',
    _id: 'family_group_member_1' as Id<'familyGroupMember'>,
    familyGroupId: 'family_group_1' as Id<'familyGroup'>,
    clerkId: 'clerk_owner',
    name: 'Igor',
    email: 'igor@kualia.com',
    role: 'owner',
    isCurrentUser: true,
    joinedAt: '2026-06-10T12:00:00.000Z',
    currentUserRole: 'owner',
    canRemove: false,
    ...overrides,
  };
}

function createInvitedMember(overrides: Partial<InvitedMemberDetails> = {}): InvitedMemberDetails {
  return {
    kind: 'invite',
    _id: 'family_group_invite_1' as Id<'familyGroupInvite'>,
    familyGroupId: 'family_group_1' as Id<'familyGroup'>,
    name: 'Casey',
    email: 'casey@example.com',
    invitedByName: 'Igor',
    status: 'pending',
    createdAt: '2026-06-10T12:00:00.000Z',
    lastSentAt: '2026-06-10T12:00:00.000Z',
    expiresAt: '2026-06-24T12:00:00.000Z',
    currentUserRole: 'owner',
    canRemove: true,
    ...overrides,
  };
}

describe('FamilyMemberComponent', () => {
  let fixture: ComponentFixture<FamilyMemberComponent>;
  let memberDetailsSignal: ReturnType<typeof signal<FamilyGroupMemberDetails | null | undefined>>;
  let openDialogSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    memberDetailsSignal = signal<FamilyGroupMemberDetails | null | undefined>(null);
    openDialogSpy = vi.fn().mockReturnValue({ close: vi.fn() });

    const mockConvexService = {
      query: vi.fn().mockReturnValue(memberDetailsSignal.asReadonly()),
      mutation: vi.fn(),
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

    const mockActivatedRoute = {
      snapshot: {
        paramMap: convertToParamMap({ userId: 'family_group_member_1' }),
      },
    } as unknown as ActivatedRoute;

    await TestBed.configureTestingModule({
      imports: [FamilyMemberComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: mockActivatedRoute },
        { provide: ConvexService, useValue: mockConvexService },
        { provide: HlmDialogService, useValue: mockDialogService },
        { provide: WorkspaceService, useValue: mockWorkspaceService },
        { provide: HlmSidebarService, useValue: mockSidebarService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FamilyMemberComponent);
  });

  it('does not show loading UI while member details are unresolved', () => {
    memberDetailsSignal.set(undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Family');
    expect(fixture.nativeElement.textContent).not.toContain('Loading member');
    expect(fixture.nativeElement.textContent).not.toContain('Not Found');
    expect(fixture.nativeElement.querySelector('[data-testid="member-breadcrumb-name"]')).toBeNull();
  });

  it('does not show the remove action for the family group owner', () => {
    memberDetailsSignal.set(createJoinedMember());
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Igor');
    expect(fixture.nativeElement.textContent).toContain('Group Manager');
    expect(fixture.nativeElement.querySelector('[data-testid="remove-family-member"]')).toBeNull();
  });

  it('shows the member name in the breadcrumb header', () => {
    memberDetailsSignal.set(createJoinedMember({ name: 'Igor Amidzic' }));
    fixture.detectChanges();

    const breadcrumbName = fixture.nativeElement.querySelector('[data-testid="member-breadcrumb-name"]');
    expect(fixture.nativeElement.textContent).toContain('Family');
    expect(breadcrumbName?.textContent).toContain('Igor Amidzic');
  });

  it('opens the remove member confirmation for a removable member', () => {
    const member = createJoinedMember({
      _id: 'family_group_member_2' as Id<'familyGroupMember'>,
      clerkId: 'clerk_member',
      name: 'Morgan',
      email: 'morgan@example.com',
      role: 'member',
      isCurrentUser: false,
      canRemove: true,
    });

    memberDetailsSignal.set(member);
    fixture.detectChanges();

    const removeButton = fixture.nativeElement.querySelector(
      '[data-testid="remove-family-member"]'
    ) as HTMLButtonElement;
    removeButton.click();

    expect(openDialogSpy).toHaveBeenCalledWith(
      RemoveFamilyMemberDialogComponent,
      expect.objectContaining({
        context: expect.objectContaining({
          target: member,
          onClose: expect.any(Function),
        }),
      })
    );
  });

  it('shows the revoke invite action for a pending invite', () => {
    memberDetailsSignal.set(createInvitedMember());
    fixture.detectChanges();

    const removeButton = fixture.nativeElement.querySelector(
      '[data-testid="remove-family-member"]'
    ) as HTMLButtonElement;
    expect(removeButton.textContent).toContain('Revoke Invite');
    expect(fixture.nativeElement.textContent).toContain('Pending invite');
  });

  it('subscribes to the member details query with the route user id', () => {
    const convexService = TestBed.inject(ConvexService);

    expect(convexService.query).toHaveBeenCalledWith(api.familyGroups.getMemberDetails, {
      userId: 'family_group_member_1',
    });
  });
});
