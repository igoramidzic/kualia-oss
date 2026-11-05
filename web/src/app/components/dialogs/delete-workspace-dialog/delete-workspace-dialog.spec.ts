import { DIALOG_DATA } from '@angular/cdk/dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { DeleteWorkspaceDialogComponent } from './delete-workspace-dialog';

type DeleteWorkspaceDialogHarness = {
  confirmDelete: () => Promise<void>;
};

function createConvexPermissionError(): Error {
  return new Error(`[CONVEX M(workspaces:deleteWorkspace)] [Request ID: test] Server Error
Uncaught ConvexError: Access denied: You do not have permission to manage this workspace
    at requireWorkspaceManagementAccess
Called by client`);
}

describe('DeleteWorkspaceDialogComponent', () => {
  let fixture: ComponentFixture<DeleteWorkspaceDialogComponent>;
  let mutationSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mutationSpy = vi.fn();

    await TestBed.configureTestingModule({
      imports: [DeleteWorkspaceDialogComponent],
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

    fixture = TestBed.createComponent(DeleteWorkspaceDialogComponent);
    fixture.detectChanges();
  });

  it('shows a concise permission error instead of the raw Convex client error', async () => {
    mutationSpy.mockRejectedValue(createConvexPermissionError());

    await expect(
      (fixture.componentInstance as unknown as DeleteWorkspaceDialogHarness).confirmDelete()
    ).rejects.toThrow();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('You do not have permission to delete this workspace.');
    expect(fixture.nativeElement.textContent).not.toContain('[CONVEX M(workspaces:deleteWorkspace)]');
    expect(fixture.nativeElement.textContent).not.toContain('Called by client');
  });
});
