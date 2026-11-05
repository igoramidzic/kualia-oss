import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService, type SidebarVariant } from '@spartan-ng/helm/sidebar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencySelectorComponent } from '../../../components/currency-selector/currency-selector.component';
import { TimezoneSelectorComponent } from '../../../components/timezone-selector/timezone-selector.component';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { WorkspaceComponent } from './workspace';

type WorkspaceValue = ReturnType<WorkspaceService['workspace']>;

function createWorkspace(canManage: boolean): WorkspaceValue {
  return {
    _id: 'workspace_12345678',
    _creationTime: 1,
    name: 'Family Budget',
    readyToAssign: 0n,
    currency: 'USD',
    subscriptions: [],
    hasActiveNonExpiredSubscription: true,
    timezone: 'America/New_York',
    transactionDefaultPendingStatus: false,
    ownerClerkId: 'clerk_owner',
    owner: {
      clerkId: 'clerk_owner',
      name: 'Morgan Owner',
      email: 'morgan@example.com',
    },
    canManage,
  };
}

describe('WorkspaceComponent', () => {
  let fixture: ComponentFixture<WorkspaceComponent>;
  let workspace: ReturnType<typeof signal<WorkspaceValue>>;
  let openDialogSpy: ReturnType<typeof vi.fn>;
  let updateCurrencySpy: ReturnType<typeof vi.fn>;
  let updateTimezoneSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    workspace = signal(createWorkspace(true));
    openDialogSpy = vi.fn();
    updateCurrencySpy = vi.fn();
    updateTimezoneSpy = vi.fn();

    const workspaceServiceMock = {
      workspace: workspace.asReadonly(),
      workspaceId: signal('workspace_12345678').asReadonly(),
      workspaceShortId: signal('personal').asReadonly(),
      updateTimezone: updateTimezoneSpy,
      updateCurrency: updateCurrencySpy,
    } as unknown as WorkspaceService;

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

    await TestBed.configureTestingModule({
      imports: [WorkspaceComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: ConvexService, useValue: { mutation: vi.fn() } },
        { provide: HlmDialogService, useValue: { open: openDialogSpy } },
        { provide: HlmSidebarService, useValue: sidebarServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorkspaceComponent);
    fixture.detectChanges();
  });

  it('shows workspace lifecycle actions for managers', () => {
    expect(fixture.nativeElement.textContent).toContain('Archive workspace');
    expect(fixture.nativeElement.textContent).toContain('Delete workspace');
  });

  it('groups related settings instead of rendering one card per option', () => {
    expect(fixture.nativeElement.querySelectorAll('[data-testid="workspace-detail-row"]')).toHaveLength(3);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="workspace-lifecycle-row"]')).toHaveLength(2);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="workspace-details-card"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelectorAll('[data-testid="workspace-lifecycle-card"]')).toHaveLength(1);

    const sectionHeadings = Array.from(fixture.nativeElement.querySelectorAll<HTMLHeadingElement>('h2')).map(
      (heading) => heading.textContent?.trim()
    );
    expect(sectionHeadings).toEqual(['Workspace management']);
  });

  it('shows editable workspace controls for managers', () => {
    const nameInput = fixture.nativeElement.querySelector('[data-testid="workspace-name-input"]') as HTMLInputElement;
    const timezoneSelector = fixture.debugElement.query(By.directive(TimezoneSelectorComponent))
      .componentInstance as TimezoneSelectorComponent;
    const timezoneTrigger = fixture.nativeElement.querySelector(
      '[data-testid="workspace-timezone-selector"] hlm-combobox-trigger button'
    ) as HTMLButtonElement;
    const archiveButton = fixture.nativeElement.querySelector(
      '[data-testid="workspace-archive-button"]'
    ) as HTMLButtonElement;
    const deleteButton = fixture.nativeElement.querySelector(
      '[data-testid="workspace-delete-button"]'
    ) as HTMLButtonElement;
    const currencySelector = fixture.debugElement.query(By.directive(CurrencySelectorComponent))
      .componentInstance as CurrencySelectorComponent;
    const currencyTrigger = fixture.debugElement
      .query(By.directive(CurrencySelectorComponent))
      .nativeElement.querySelector('hlm-combobox-trigger button') as HTMLButtonElement;

    expect(nameInput.disabled).toBe(false);
    expect(timezoneSelector.disabled()).toBe(false);
    expect(timezoneTrigger.disabled).toBe(false);
    expect(currencySelector.disabled()).toBe(false);
    expect(currencyTrigger.disabled).toBe(false);
    expect(archiveButton.disabled).toBe(false);
    expect(deleteButton.disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('New York, America');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-readonly-alert"]')).toBeNull();
  });

  it('shows disabled workspace settings for non-managers', () => {
    workspace.set(createWorkspace(false));
    fixture.detectChanges();

    const nameInput = fixture.nativeElement.querySelector('[data-testid="workspace-name-input"]') as HTMLInputElement;
    const timezoneSelector = fixture.debugElement.query(By.directive(TimezoneSelectorComponent))
      .componentInstance as TimezoneSelectorComponent;
    const timezoneTrigger = fixture.nativeElement.querySelector(
      '[data-testid="workspace-timezone-selector"] hlm-combobox-trigger button'
    ) as HTMLButtonElement;
    const archiveButton = fixture.nativeElement.querySelector(
      '[data-testid="workspace-archive-button"]'
    ) as HTMLButtonElement;
    const deleteButton = fixture.nativeElement.querySelector(
      '[data-testid="workspace-delete-button"]'
    ) as HTMLButtonElement;
    const currencySelector = fixture.debugElement.query(By.directive(CurrencySelectorComponent))
      .componentInstance as CurrencySelectorComponent;
    const currencyTrigger = fixture.debugElement
      .query(By.directive(CurrencySelectorComponent))
      .nativeElement.querySelector('hlm-combobox-trigger button') as HTMLButtonElement;

    expect(nameInput.disabled).toBe(true);
    expect(timezoneSelector.disabled()).toBe(true);
    expect(timezoneTrigger.disabled).toBe(true);
    expect(currencySelector.disabled()).toBe(true);
    expect(currencyTrigger.disabled).toBe(true);
    expect(archiveButton.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
    currencySelector.selectCurrency('EUR');
    expect(updateCurrencySpy).not.toHaveBeenCalled();
    timezoneSelector.selectTimezone('Australia/Adelaide');
    expect(updateTimezoneSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Archive workspace');
    expect(fixture.nativeElement.textContent).toContain('Delete workspace');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-readonly-alert"]')?.textContent).toContain(
      'only Morgan Owner can edit this workspace'
    );
  });
});
