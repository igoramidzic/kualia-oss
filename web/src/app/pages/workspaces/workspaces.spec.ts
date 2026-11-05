import { provideZonelessChangeDetection, signal, type Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../services/convex.service';
import { ReportingService } from '../../services/reporting.service';
import { WorkspaceService } from '../../services/workspace.service';
import { WorkspacesComponent, type Workspace, type WorkspaceSections } from './workspaces';

function createWorkspace(
  id: string,
  name: string,
  accessKind: Workspace['accessKind'],
  overrides: Partial<Workspace> = {}
): Workspace {
  const ownerClerkId = accessKind === 'owner' ? 'clerk_user' : 'clerk_owner';

  return {
    _id: id as Id<'workspace'>,
    _creationTime: 1,
    name,
    role: accessKind === 'owner' ? 'admin' : 'member',
    isArchived: false,
    ownerClerkId,
    owner: {
      clerkId: ownerClerkId,
      name: accessKind === 'owner' ? 'Current User' : 'Family Owner',
      email: accessKind === 'owner' ? 'current@example.com' : 'owner@example.com',
    },
    accessKind,
    canManage: accessKind === 'owner',
    ...overrides,
  };
}

describe('WorkspacesComponent', () => {
  let workspaceSectionsSignal: ReturnType<typeof signal<WorkspaceSections | undefined>>;
  let queryMock: ReturnType<typeof vi.fn>;

  function createComponent(): WorkspacesComponent {
    queryMock = vi.fn(<T>() => workspaceSectionsSignal.asReadonly() as Signal<T | undefined>);

    const convexServiceMock: Pick<ConvexService, 'query' | 'mutation'> = {
      query: queryMock as ConvexService['query'],
      mutation: vi.fn().mockResolvedValue(undefined) as ConvexService['mutation'],
    };

    const workspaceServiceMock: Pick<WorkspaceService, 'workspace'> = {
      workspace: signal(undefined).asReadonly(),
    };

    const routerMock = {
      navigate: vi.fn().mockResolvedValue(true),
    } as unknown as Router;

    const dialogServiceMock = {
      open: vi.fn().mockReturnValue({ close: vi.fn() }),
    } as unknown as HlmDialogService;

    const reportingServiceMock: Pick<ReportingService, 'capture'> = {
      capture: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: ConvexService, useValue: convexServiceMock },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: Router, useValue: routerMock },
        { provide: HlmDialogService, useValue: dialogServiceMock },
        { provide: ReportingService, useValue: reportingServiceMock },
      ],
    });

    return TestBed.runInInjectionContext(() => new WorkspacesComponent());
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('uses grouped workspace sections from the backend query', () => {
    workspaceSectionsSignal = signal<WorkspaceSections | undefined>({
      ownWorkspaces: [],
      sharedWorkspaces: [],
    });

    createComponent();

    expect(queryMock).toHaveBeenCalledWith(api.workspaces.getWorkspaceSections, {});
  });

  it('groups active owned workspaces before active family shared workspaces', () => {
    workspaceSectionsSignal = signal<WorkspaceSections | undefined>({
      ownWorkspaces: [
        createWorkspace('workspace_own_active', 'Personal Budget', 'owner'),
        createWorkspace('workspace_own_archived', 'Archived Personal', 'owner', { isArchived: true }),
      ],
      sharedWorkspaces: [
        createWorkspace('workspace_shared_active', 'Family Budget', 'family'),
        createWorkspace('workspace_shared_archived', 'Archived Family', 'family', { isArchived: true }),
      ],
    });

    const component = createComponent();
    const sections = component.activeWorkspaceSections();

    expect(sections.map((section) => section.label)).toEqual(['My workspaces', 'Shared with me']);
    expect(sections[0]?.workspaces.map((workspace) => workspace.name)).toEqual(['Personal Budget']);
    expect(sections[1]?.workspaces.map((workspace) => workspace.name)).toEqual(['Family Budget']);
    expect(component.archivedWorkspaces().map((workspace) => workspace.name)).toEqual([
      'Archived Personal',
      'Archived Family',
    ]);
    expect(component.archivedCount()).toBe(2);
  });

  it('shows loading until the grouped query returns', () => {
    workspaceSectionsSignal = signal<WorkspaceSections | undefined>(undefined);

    const component = createComponent();

    expect(component.loading()).toBe(true);
    expect(component.activeWorkspaceSections()).toEqual([]);
  });
});
