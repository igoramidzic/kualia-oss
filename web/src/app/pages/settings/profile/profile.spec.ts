import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { api } from 'convex/_generated/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../services/auth.service';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { ProfileComponent } from './profile';

vi.mock('ngx-sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ProfileComponent', () => {
  let fixture: ComponentFixture<ProfileComponent>;
  let user: ReturnType<
    typeof signal<{
      id: string;
      email: string;
      authProviderLabel: string;
      emailVerified: boolean;
      createdAt: Date | null;
      updatedAt: Date | null;
    }>
  >;
  let userProfile: ReturnType<
    typeof signal<{
      _id: string;
      name: string;
      email: string;
      clerkId: string;
      updatedAt: string;
      activeWorkspaceId: null;
      onboardingCompleted: boolean;
      isV1User: boolean;
      notificationsEnabled: boolean;
      notificationPreferences: undefined;
    } | null>
  >;
  let mutation: ReturnType<typeof vi.fn>;
  let openDialog: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    user = signal({
      id: 'user_123',
      email: 'clerk@example.com',
      authProviderLabel: 'Google',
      emailVerified: true,
      createdAt: null,
      updatedAt: null,
    });
    userProfile = signal({
      _id: 'user_profile_123',
      name: 'Igor',
      email: 'igor@example.com',
      clerkId: 'user_123',
      updatedAt: '2026-06-11T12:00:00.000Z',
      activeWorkspaceId: null,
      onboardingCompleted: true,
      isV1User: false,
      notificationsEnabled: false,
      notificationPreferences: undefined,
    });
    mutation = vi.fn().mockResolvedValue({ success: true });
    openDialog = vi.fn();

    const authServiceMock = {
      user: user.asReadonly(),
    } as unknown as AuthService;

    const convexServiceMock = {
      query: vi.fn().mockReturnValue(userProfile.asReadonly()),
      mutation,
    } as unknown as ConvexService;

    const workspaceServiceMock = {
      workspace: signal({ name: 'Personal' }).asReadonly(),
      workspaceShortId: signal('personal').asReadonly(),
    } as unknown as WorkspaceService;

    await TestBed.configureTestingModule({
      imports: [ProfileComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: authServiceMock },
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: HlmDialogService, useValue: { open: openDialog } },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: HlmSidebarService, useValue: { toggleSidebar: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
  });

  function queryInput(testId: string): HTMLInputElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
  }

  function queryElement(testId: string): HTMLElement {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`) as HTMLElement;
  }

  function typeName(value: string): void {
    const input = queryInput('profile-name-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('renders profile fields from the current user', () => {
    expect(queryInput('profile-name-input').value).toBe('Igor');
    expect(queryElement('profile-email-badge').textContent?.trim()).toBe('igor@example.com');
    expect(queryElement('profile-provider-badge').textContent?.trim()).toBe('Google');
  });

  it('shows email and provider as non-input display values', () => {
    expect(fixture.nativeElement.querySelector('[data-testid="profile-email-input"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="profile-provider-input"]')).toBeNull();
    expect(queryElement('profile-email-badge').tagName).toBe('SPAN');
    expect(queryElement('profile-provider-badge').tagName).toBe('SPAN');
  });

  it('saves changed names on blur', async () => {
    typeName('Iggy');

    queryInput('profile-name-input').dispatchEvent(new Event('blur'));

    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledWith(api.userProfiles.updateProfile, { name: 'Iggy' });
    });
  });

  it('saves changed names on enter and unfocuses the input', async () => {
    typeName('Iggy');
    const input = queryInput('profile-name-input');
    const blur = vi.spyOn(input, 'blur');
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });

    input.focus();
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(blur).toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledWith(api.userProfiles.updateProfile, { name: 'Iggy' });
    });
  });

  it('does not save unchanged names on blur', () => {
    queryInput('profile-name-input').dispatchEvent(new Event('blur'));

    expect(mutation).not.toHaveBeenCalled();
  });

  it('does not save empty names on blur', () => {
    typeName('   ');
    queryInput('profile-name-input').dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(mutation).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Required');
  });

  it('opens the typed account deletion confirmation from the danger zone', () => {
    const button = queryElement('delete-account-button') as HTMLButtonElement;
    button.click();

    expect(openDialog).toHaveBeenCalledOnce();
  });
});
