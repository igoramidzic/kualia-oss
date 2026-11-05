import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../services/auth.service';
import { ConvexService } from '../../services/convex.service';
import { WorkspaceService } from '../../services/workspace.service';
import { SidebarOrganizationDropdownComponent } from './sidebar-organization-dropdown';
import sidebarOrganizationDropdownTemplate from './sidebar-organization-dropdown.html?raw';

type AuthUser = {
  id: string;
  email: string;
  imageUrl: string | null;
  name: string;
  firstName: string;
  lastName: string;
  authProviderLabel: string;
  emailVerified: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
};

describe('SidebarOrganizationDropdownComponent', () => {
  let fixture: ComponentFixture<SidebarOrganizationDropdownComponent>;
  let authUser: ReturnType<typeof signal<AuthUser>>;
  let userProfile: ReturnType<
    typeof signal<{
      name: string;
      email: string;
    } | null>
  >;

  beforeEach(() => {
    userProfile = signal({
      name: 'Igor',
      email: 'igor@example.com',
    });
    authUser = signal({
      id: 'user_123',
      email: 'igor@example.com',
      imageUrl: 'https://images.example.com/avatar.jpg',
      name: 'Igor Amidzic',
      firstName: 'Igor',
      lastName: 'Amidzic',
      authProviderLabel: 'Google',
      emailVerified: true,
      createdAt: null,
      updatedAt: null,
    });

    const convexServiceMock: Pick<ConvexService, 'query'> = {
      query: vi.fn(() => {
        return userProfile.asReadonly();
      }) as unknown as ConvexService['query'],
    };

    const authServiceMock = {
      user: authUser.asReadonly(),
      logout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Pick<AuthService, 'user' | 'logout'>;

    const workspaceServiceMock: Pick<WorkspaceService, 'workspace' | 'workspaceShortId' | 'workspaceId'> = {
      workspace: signal({ name: 'Main Workspace' }).asReadonly() as WorkspaceService['workspace'],
      workspaceShortId: signal('main').asReadonly(),
      workspaceId: signal('workspace-id').asReadonly(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarOrganizationDropdownComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
      ],
    });

    fixture = TestBed.createComponent(SidebarOrganizationDropdownComponent);
  });

  it('renders the user profile name', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Igor');
    expect(fixture.nativeElement.textContent).not.toContain('Main Workspace');
  });

  it('does not render the app logo inside the workspace picker', () => {
    fixture.detectChanges();

    const logos = fixture.nativeElement.querySelectorAll<HTMLImageElement>('img[alt="Kualia"]');
    expect(logos.length).toBe(0);
  });

  it('uses the Clerk profile image for the avatar', () => {
    fixture.detectChanges();

    expect(fixture.componentInstance['userImageUrl']()).toBe('https://images.example.com/avatar.jpg');
  });

  it('renders a user icon when Clerk has no profile image', () => {
    authUser.set({ ...authUser(), imageUrl: null });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('img[hlmAvatarImage]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="user-avatar-fallback"] nucleo-icon')).not.toBeNull();
  });

  it('keeps workspace switching out of the user menu', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Switch workspace');
  });

  it('links account settings from the user menu', () => {
    expect(fixture.componentInstance['settingsLink']).toBe('/settings');
    expect(sidebarOrganizationDropdownTemplate).toContain('<span>Account settings</span>');
  });
});
