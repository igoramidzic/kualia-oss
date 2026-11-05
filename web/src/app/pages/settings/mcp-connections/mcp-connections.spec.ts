import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConvexService } from '../../../services/convex.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { McpConnectionsComponent } from './mcp-connections';

type McpConnectionList = FunctionReturnType<typeof api.mcp.listOauthConnections>;

describe('McpConnectionsComponent', () => {
  let fixture: ComponentFixture<McpConnectionsComponent>;
  let connections: ReturnType<typeof signal<McpConnectionList | undefined>>;
  let openDialog: ReturnType<typeof vi.fn>;
  let query: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    connections = signal<McpConnectionList | undefined>([
      {
        clientId: 'kualia_client_claude',
        clientName: 'Claude',
        clientUri: 'https://claude.ai',
        redirectUris: ['http://localhost:6274/callback'],
        scopes: ['app:read', 'transactions:write'],
        resource: 'https://api.kualia.com/mcp',
        connectedAt: '2026-08-01T12:00:00.000Z',
        lastAuthorizedAt: '2026-08-20T12:00:00.000Z',
        lastUsedAt: '2026-08-29T13:15:00.000Z',
      },
    ]);
    query = vi.fn().mockReturnValue(connections.asReadonly());
    openDialog = vi.fn().mockReturnValue({ close: vi.fn() });

    await TestBed.configureTestingModule({
      imports: [McpConnectionsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: ConvexService, useValue: { query } },
        { provide: HlmDialogService, useValue: { open: openDialog } },
        { provide: HlmSidebarService, useValue: { toggleSidebar: vi.fn() } },
        {
          provide: WorkspaceService,
          useValue: {
            workspace: signal({ name: 'Personal' }).asReadonly(),
            workspaceShortId: signal('personal').asReadonly(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(McpConnectionsComponent);
  });

  it('lists connection destination, permissions, and usage details', () => {
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(query).toHaveBeenCalledWith(api.mcp.listOauthConnections, {
      nowMs: expect.any(Number),
    });
    expect(text).toContain('Claude');
    expect(text).toContain('claude.ai');
    expect(text).toContain('View Kualia data');
    expect(text).toContain('Manage transactions');
    expect(text).toContain('Last used');
    expect(text).toContain('api.kualia.com');
    expect(fixture.nativeElement.querySelector('a[href="https://claude.ai/"]')).not.toBeNull();
  });

  it('shows an empty state without a retired hosted documentation link', () => {
    connections.set([]);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No MCP connections');
    expect(fixture.nativeElement.textContent).toContain('Apps will appear here after you approve');
    expect(fixture.nativeElement.querySelector('a[href*="docs.kualia.com"]')).toBeNull();
  });

  it('opens the revoke confirmation for the selected client', () => {
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="revoke-mcp-connection-kualia_client_claude"]'
    );
    button.click();

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openDialog.mock.calls[0][1].context).toMatchObject({
      clientId: 'kualia_client_claude',
      clientName: 'Claude',
      clientDestination: 'claude.ai',
    });
  });
});
