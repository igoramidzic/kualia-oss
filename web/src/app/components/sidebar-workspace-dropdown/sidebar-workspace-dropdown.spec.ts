import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../services/convex.service';
import { WorkspaceService } from '../../services/workspace.service';
import { SidebarWorkspaceDropdownComponent } from './sidebar-workspace-dropdown';

describe('SidebarWorkspaceDropdownComponent', () => {
  let fixture: ComponentFixture<SidebarWorkspaceDropdownComponent>;
  let queryMock: ReturnType<typeof vi.fn>;
  let mutationMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryMock = vi.fn().mockResolvedValue([
      { _id: 'workspace-current', _creationTime: 1, name: 'Home', role: 'admin' },
      { _id: 'workspace-other', _creationTime: 2, name: 'Family', role: 'member' },
    ]);
    mutationMock = vi.fn().mockResolvedValue(undefined);

    const convexClientMock = { query: queryMock } as unknown as ReturnType<ConvexService['getClient']>;
    const convexServiceMock: Pick<ConvexService, 'isAuthenticated' | 'getClient' | 'mutation'> = {
      isAuthenticated: () => true,
      getClient: () => convexClientMock,
      mutation: mutationMock,
    };
    const workspaceServiceMock: Pick<WorkspaceService, 'workspace' | 'workspaceId'> = {
      workspace: signal({ name: 'Home' }).asReadonly() as WorkspaceService['workspace'],
      workspaceId: signal('workspace-current').asReadonly(),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarWorkspaceDropdownComponent],
      providers: [
        provideRouter([]),
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
      ],
    });

    fixture = TestBed.createComponent(SidebarWorkspaceDropdownComponent);
  });

  it('shows the current workspace beside the Kualia logo', () => {
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Home');
    expect(fixture.nativeElement.querySelectorAll('img').length).toBe(2);
  });

  it('loads the available workspaces', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    expect(queryMock).toHaveBeenCalledOnce();
    expect(fixture.componentInstance['workspaces']()).toHaveLength(2);
  });

  it('switches to a different workspace', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    const navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    await fixture.componentInstance['selectWorkspace'](fixture.componentInstance['workspaces']()[1]);

    expect(mutationMock).toHaveBeenCalledOnce();
    expect(navigateSpy).toHaveBeenCalledOnce();
  });
});
