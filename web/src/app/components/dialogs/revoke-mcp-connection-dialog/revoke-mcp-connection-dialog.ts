import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { api } from 'convex/_generated/api';
import { ConvexError } from 'convex/values';
import { nucleoLoader as LoaderCircle, NucleoIcon } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { ConvexService } from '../../../services/convex.service';

interface DialogContext {
  clientId: string;
  clientName: string;
  clientDestination: string;
  onClose: (revoked?: boolean) => void;
}

@Component({
  selector: 'app-revoke-mcp-connection-dialog',
  imports: [HlmButton, HlmDialogHeader, HlmDialogFooter, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Revoke MCP connection</h2>
      <p class="text-muted-foreground text-sm">
        Remove <span class="text-foreground font-medium">{{ dialogContext.clientName }}</span>
        ({{ dialogContext.clientDestination }})?
      </p>
    </hlm-dialog-header>

    <div class="space-y-4 p-4">
      <p class="text-sm leading-6">
        This app will immediately lose access to your Kualia data. To use it again, you will need to approve a new
        connection.
      </p>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn type="button" size="sm" variant="outline" (click)="cancel()" [disabled]="revoking()">
        Cancel
      </button>
      <button
        hlmBtn
        type="button"
        size="sm"
        variant="destructive"
        (click)="revoke()"
        [disabled]="revoking()"
        data-testid="confirm-revoke-mcp-connection"
      >
        @if (revoking()) {
          <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
          Revoking…
        } @else {
          Revoke connection
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class RevokeMcpConnectionDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  protected readonly revoking = signal(false);
  protected readonly error = signal<string | null>(null);

  protected cancel(): void {
    this.dialogContext.onClose(false);
  }

  protected async revoke(): Promise<void> {
    if (this.revoking()) {
      return;
    }

    this.revoking.set(true);
    this.error.set(null);

    try {
      await this.convexService.mutation(api.mcp.revokeOauthConnection, {
        clientId: this.dialogContext.clientId,
      });
      toast.success('MCP connection revoked');
      this.dialogContext.onClose(true);
    } catch (error: unknown) {
      const message =
        error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Failed to revoke MCP connection';
      this.error.set(message);
      this.revoking.set(false);
    }
  }
}
