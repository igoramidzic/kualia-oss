import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { FunctionReturnType } from 'convex/server';
import {
  nucleoConnection as Cable,
  nucleoExternalLink as ExternalLink,
  NucleoIcon,
  nucleoShield as ShieldCheck,
  nucleoTrash as Trash2,
} from '@kualia/icons';
import { RevokeMcpConnectionDialogComponent } from '../../../components/dialogs/revoke-mcp-connection-dialog/revoke-mcp-connection-dialog';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { ConvexService } from '../../../services/convex.service';

type McpConnectionList = FunctionReturnType<typeof api.mcp.listOauthConnections>;
type McpConnection = McpConnectionList[number];

const SCOPE_LABELS: Record<string, string> = {
  'app:read': 'View Kualia data',
  'budgets:write': 'Manage budgets',
  'transactions:write': 'Manage transactions',
};

@Component({
  selector: 'app-mcp-connections',
  imports: [DatePipe, HlmButton, HlmCard, NucleoIcon, SettingsPageHeaderComponent],
  templateUrl: './mcp-connections.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
})
export class McpConnectionsComponent {
  protected readonly Cable = Cable;
  protected readonly ExternalLink = ExternalLink;
  protected readonly ShieldCheck = ShieldCheck;
  protected readonly Trash2 = Trash2;

  private readonly convexService = inject(ConvexService);
  private readonly dialogService = inject(HlmDialogService);
  private readonly connectionsQuery = this.convexService.query<McpConnectionList>(api.mcp.listOauthConnections, {
    nowMs: Date.now(),
  });

  protected readonly isLoading = computed(() => this.connectionsQuery() === undefined);
  protected readonly connections = computed(() => this.connectionsQuery() ?? []);

  protected clientName(connection: McpConnection): string {
    return connection.clientName ?? 'MCP client';
  }

  protected clientDestination(connection: McpConnection): string {
    return this.formatDestination(connection.clientUri ?? connection.redirectUris[0]) ?? 'Unknown destination';
  }

  protected clientWebsite(connection: McpConnection): string | null {
    if (!connection.clientUri) {
      return null;
    }

    try {
      const url = new URL(connection.clientUri);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
    } catch {
      return null;
    }
  }

  protected resourceDestination(connection: McpConnection): string | null {
    return this.formatDestination(connection.resource);
  }

  protected scopeLabel(scope: string): string {
    return SCOPE_LABELS[scope] ?? scope;
  }

  protected openRevokeDialog(connection: McpConnection): void {
    const dialogRef = this.dialogService.open(RevokeMcpConnectionDialogComponent, {
      context: {
        clientId: connection.clientId,
        clientName: this.clientName(connection),
        clientDestination: this.clientDestination(connection),
        onClose: () => dialogRef.close(),
      },
      hasBackdrop: true,
      backdropClass: 'bg-background/65',
      closeOnBackdropClick: false,
      contentClass: 'max-w-full sm:w-md',
    });
  }

  private formatDestination(value: string | undefined): string | null {
    if (!value) {
      return null;
    }

    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return url.host;
      }
      return `${url.protocol}//${url.host || url.pathname.split('/')[0]}`;
    } catch {
      return value;
    }
  }
}
