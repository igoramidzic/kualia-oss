import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmSidebarService, SidebarVariant } from '@spartan-ng/helm/sidebar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { DataExportComponent } from './export';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('ngx-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}));

describe('DataExportComponent', () => {
  let fixture: ComponentFixture<DataExportComponent>;
  let action: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    action = vi.fn();
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    anchorClick.mockClear();
    toastSuccess.mockReset();
    toastError.mockReset();

    const workspaceServiceMock = {
      workspaceId: signal<string | null>('workspace_123').asReadonly(),
      workspaceShortId: signal<string | null>('personal').asReadonly(),
      workspace: signal({ name: 'Personal' }).asReadonly(),
    } as unknown as WorkspaceService;
    const open = signal(true);
    const openMobile = signal(false);
    const isMobile = signal(false);
    const variant = signal<SidebarVariant>('sidebar');
    const sidebarServiceMock = {
      open: open.asReadonly(),
      openMobile: openMobile.asReadonly(),
      isMobile: isMobile.asReadonly(),
      variant: variant.asReadonly(),
      state: computed(() => (open() ? 'expanded' : 'collapsed')),
      setOpenMobile: vi.fn(),
      setVariant: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [DataExportComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ConvexService, useValue: { action } },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: HlmSidebarService, useValue: sidebarServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DataExportComponent);
    fixture.detectChanges();
  });

  it('creates an export and automatically starts the returned download', async () => {
    action.mockResolvedValue({
      workspaceId: 'workspace_123',
      downloadUrl: 'https://example.convex.site/exports/download?token=secret',
      filename: 'kualia-personal.zip',
      expiresAt: Date.now() + 60_000,
      counts: {
        transactionCount: 2,
        transactionMovementRowCount: 3,
        categoryCount: 1,
        planRowCount: 1,
        bankAccountCount: 1,
      },
    });

    const button = fixture.nativeElement.querySelector('[data-testid="download-export"]') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(action).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'workspace_123' });
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(toastSuccess).toHaveBeenCalledWith('Your data export is downloading');
    expect(button.disabled).toBe(false);
  });

  it('keeps the button disabled while the backend is creating the archive', async () => {
    let resolveAction: ((value: unknown) => void) | undefined;
    action.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      })
    );

    const button = fixture.nativeElement.querySelector('[data-testid="download-export"]') as HTMLButtonElement;
    button.click();
    fixture.detectChanges();

    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Creating export');

    resolveAction?.({
      downloadUrl: 'https://example.convex.site/exports/download?token=secret',
    });
    await fixture.whenStable();
  });

  it('shows an error and does not start a download when export generation fails', async () => {
    action.mockRejectedValue(new Error('Export failed'));

    const button = fixture.nativeElement.querySelector('[data-testid="download-export"]') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(anchorClick).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Export failed');
  });
});
