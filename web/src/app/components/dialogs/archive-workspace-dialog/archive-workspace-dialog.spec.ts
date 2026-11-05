import { DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { ArchiveWorkspaceDialogComponent } from './archive-workspace-dialog';

type ArchiveWorkspaceDialogHarness = {
  confirmArchive: () => Promise<void>;
};

function createConvexPermissionError(): Error {
  return new Error(`[CONVEX M(workspaces:archiveWorkspaces)] [Request ID: test] Server Error
Uncaught ConvexError: Access denied: You do not have permission to manage this workspace
    at requireWorkspaceManagementAccess
Called by client`);
}

describe('ArchiveWorkspaceDialogComponent', () => {
  let fixture: ComponentFixture<ArchiveWorkspaceDialogComponent>;
  let mutationSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mutationSpy = vi.fn();

    await TestBed.configureTestingModule({
      imports: [ArchiveWorkspaceDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: { mutation: mutationSpy } },
        {
          provide: DIALOG_DATA,
          useValue: {
            workspaceName: 'Family Budget',
            workspaceId: 'workspace_12345678',
            onClose: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ArchiveWorkspaceDialogComponent);
    fixture.detectChanges();
  });

  it('shows a concise permission error instead of the raw Convex client error', async () => {
    mutationSpy.mockRejectedValue(createConvexPermissionError());

    await expect(
      (fixture.componentInstance as unknown as ArchiveWorkspaceDialogHarness).confirmArchive()
    ).rejects.toThrow();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('You do not have permission to archive this workspace.');
    expect(fixture.nativeElement.textContent).not.toContain('[CONVEX M(workspaces:archiveWorkspaces)]');
    expect(fixture.nativeElement.textContent).not.toContain('Called by client');
  });
});
