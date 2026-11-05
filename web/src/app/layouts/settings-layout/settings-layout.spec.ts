import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { HlmSidebarService, type SidebarVariant } from '@spartan-ng/helm/sidebar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENVIRONMENT, type Environment } from '../../config/environment.token';
import { WorkspaceService } from '../../services/workspace.service';
import { SettingsLayoutComponent } from './settings-layout';

function createEnvironment(production: boolean): Environment {
  return {
    production,
    posthog: {
      apiKey: '',
      apiHost: '',
    },
    convex: {
      url: '',
      siteUrl: '',
    },
    clerk: {
      publishableKey: '',
      emailLoginEnabled: true,
    },
    logoDev: {
      token: '',
    },
  };
}

describe('SettingsLayoutComponent', () => {
  let workspaceShortId: ReturnType<typeof signal<string | null>>;
  let workspace: ReturnType<typeof signal<{ canManage: boolean }>>;

  function createComponent(production: boolean, accountSettings = false): ComponentFixture<SettingsLayoutComponent> {
    const workspaceServiceMock: Pick<WorkspaceService, 'workspaceShortId' | 'workspace'> = {
      workspaceShortId: workspaceShortId.asReadonly(),
      workspace: workspace.asReadonly() as WorkspaceService['workspace'],
    };

    const open = signal(true);
    const openMobile = signal(false);
    const isMobile = signal(false);
    const variant = signal<SidebarVariant>('sidebar');
    const sidebarServiceMock: Pick<
      HlmSidebarService,
      'open' | 'openMobile' | 'isMobile' | 'variant' | 'state' | 'setOpenMobile' | 'setVariant'
    > = {
      open: open.asReadonly(),
      openMobile: openMobile.asReadonly(),
      isMobile: isMobile.asReadonly(),
      variant: variant.asReadonly(),
      state: computed(() => (open() ? 'expanded' : 'collapsed')),
      setOpenMobile: vi.fn(),
      setVariant: vi.fn((nextVariant: SidebarVariant) => variant.set(nextVariant)),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SettingsLayoutComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ENVIRONMENT, useValue: createEnvironment(production) },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: HlmSidebarService, useValue: sidebarServiceMock },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { settingsScope: accountSettings ? 'account' : 'workspace' } } },
        },
      ],
    });

    const fixture = TestBed.createComponent(SettingsLayoutComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    workspaceShortId = signal('personal');
    workspace = signal({ canManage: true });
  });

  it('does not mix account settings into the workspace sidebar', () => {
    const fixture = createComponent(false);

    const familyLink = fixture.nativeElement.querySelector('a[aria-label="Family"]');
    const profileLink = fixture.nativeElement.querySelector('a[aria-label="Profile"]');
    const billingLink = fixture.nativeElement.querySelector('a[aria-label="Billing"]');
    const mcpConnectionsLink = fixture.nativeElement.querySelector('a[aria-label="MCP connections"]');

    expect(familyLink).toBeNull();
    expect(profileLink).toBeNull();
    expect(billingLink).toBeNull();
    expect(mcpConnectionsLink).toBeNull();
  });

  it('shows General in the workspace sidebar', () => {
    const fixture = createComponent(false);

    const generalLink = fixture.nativeElement.querySelector('a[aria-label="General"]');

    expect(generalLink).not.toBeNull();
    expect(generalLink.getAttribute('href')).toBe('/personal/settings/general');
  });

  it('shows MCP connections in account settings only', () => {
    const accountFixture = createComponent(false, true);

    const connectionLink = accountFixture.nativeElement.querySelector('a[aria-label="MCP connections"]');

    expect(connectionLink).not.toBeNull();
    expect(connectionLink.getAttribute('href')).toBe('/settings/mcp-connections');
  });

  it('shows General when the current user cannot manage the workspace', () => {
    workspace.set({ canManage: false });
    const fixture = createComponent(false);

    const generalLink = fixture.nativeElement.querySelector('a[aria-label="General"]');

    expect(generalLink).not.toBeNull();
    expect(generalLink.getAttribute('href')).toBe('/personal/settings/general');
  });

  it('places Activity below Export without a Workspace section label', () => {
    const fixture = createComponent(false);

    const activityLink = fixture.nativeElement.querySelector('a[aria-label="Activity"]');
    const exportLink = fixture.nativeElement.querySelector('a[aria-label="Export"]');

    expect(activityLink).not.toBeNull();
    expect(activityLink.getAttribute('href')).toBe('/personal/settings/activity');
    expect(exportLink.compareDocumentPosition(activityLink) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(fixture.nativeElement.textContent).not.toContain('Workspace');
  });

  it('shows the workspace Export link', () => {
    const fixture = createComponent(false);

    const exportLink = fixture.nativeElement.querySelector('a[aria-label="Export"]');

    expect(exportLink).not.toBeNull();
    expect(exportLink.getAttribute('href')).toBe('/personal/settings/export');
  });
});
