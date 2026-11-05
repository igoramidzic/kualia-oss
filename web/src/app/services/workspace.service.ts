import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { ConvexService } from './convex.service';

type WorkspaceQueryResult = {
  _id: string;
  _creationTime: number;
  name: string;
  readyToAssign: bigint;
  currency?: string;
  subscriptions: {
    stripePriceId: string;
    stripeProductId: string;
    status: string;
    planName: string;
    billingPeriod: string;
    amount: number;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
  }[];
  hasActiveNonExpiredSubscription: boolean;
  timezone?: string;
  expectedMonthlyIncome?: bigint;
  bankAccountOrdering?: {
    groupOrder: string[];
    accountOrderByGroup: Record<string, string[]>;
  };
  onboardingCompleted?: boolean;
  transactionDefaultAccountId?: string;
  transactionDefaultPendingStatus?: boolean;
  ownerClerkId?: string;
  owner?: {
    clerkId: string;
    name: string | null;
    email: string | null;
  } | null;
  canManage: boolean;
};

@Injectable({
  providedIn: 'root',
})
export class WorkspaceService {
  private readonly convexService = inject(ConvexService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  private readonly _workspace = signal<WorkspaceQueryResult | undefined>(undefined);
  private readonly _workspaceId = signal<string | null>(null);
  private readonly _workspaceShortId = signal<string | null>(null);
  private readonly _loadingWorkspace = signal<boolean>(false);
  /**
   * How many non-deleted workspaces the current user belongs to. Drives UI that should only
   * appear for multi-workspace users (e.g. the chat-panel workspace-context card). `null` until
   * the first server response arrives — callers should treat null as "unknown" rather than 0.
   */
  private readonly _userWorkspaceCount = signal<number | null>(null);
  private workspaceSubscription?: () => void;
  private userWorkspacesSubscription?: () => void;

  readonly workspace = this._workspace.asReadonly();
  readonly workspaceId = this._workspaceId.asReadonly();
  readonly workspaceShortId = this._workspaceShortId.asReadonly();
  readonly loadingWorkspace = this._loadingWorkspace.asReadonly();
  readonly userWorkspaceCount = this._userWorkspaceCount.asReadonly();

  // Always return true - subscriptions are no longer required
  readonly hasActiveSubscription = computed(() => true);

  constructor() {
    // Effect: Fetch workspace by short ID when Convex is authenticated and short ID changes
    // We must wait for Convex auth because queries require a valid auth token.
    effect(() => {
      const isAuthenticated = this.convexService.isAuthenticated();
      const shortId = this._workspaceShortId();

      if (isAuthenticated && shortId) {
        void this.fetchWorkspaceByShortId(shortId);
      } else if (!shortId) {
        // Clear workspace data if no short ID
        this._workspace.set(undefined);
        this._workspaceId.set(null);
        this.stopWatchingWorkspace();
      }
      // If shortId exists but not authenticated yet, wait for auth to complete
    });

    // Effect: Watch workspace details once we have the full workspace ID
    // For real-time subscriptions, we still check Convex auth since that's what
    // the Convex client uses for WebSocket connections
    effect(() => {
      const isAuthenticated = this.convexService.isAuthenticated();
      const workspaceId = this._workspaceId();

      if (isAuthenticated && workspaceId) {
        this.startWatchingWorkspace(workspaceId);
      } else {
        this.stopWatchingWorkspace();
      }
    });

    // Effect: Redirect to /workspaces if workspace loading completed but workspace not found
    effect(() => {
      const loadingWorkspace = this._loadingWorkspace();
      const workspaceId = this._workspaceId();
      const workspaceShortId = this._workspaceShortId();
      const isAuthenticated = this.convexService.isAuthenticated();

      // Only redirect if:
      // 1. We're authenticated (so we've tried to load)
      // 2. We have a short ID (meaning we're on a workspace route)
      // 3. Loading is complete (false)
      // 4. Workspace ID is null (workspace not found)
      if (isAuthenticated && workspaceShortId && !loadingWorkspace && !workspaceId) {
        // Clear the short ID to prevent redirect loop
        this._workspaceShortId.set(null);
        void this.router.navigate(['/workspaces']);
      }
    });

    // Watch the user's workspace list so consumers can branch on count (single-workspace UIs
    // hide chrome that only makes sense when there are multiple workspaces).
    effect(() => {
      const isAuthenticated = this.convexService.isAuthenticated();
      if (isAuthenticated) {
        this.startWatchingUserWorkspaces();
      } else {
        this.stopWatchingUserWorkspaces();
        this._userWorkspaceCount.set(null);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.stopWatchingWorkspace();
      this.stopWatchingUserWorkspaces();
    });
  }

  private startWatchingUserWorkspaces(): void {
    this.stopWatchingUserWorkspaces();
    const watcher = this.convexService.watchQuery<{ _id: string }[]>(api.workspaces.getUserWorkspaces, {});
    this.userWorkspacesSubscription = watcher.subscribe((data) => {
      if (data === undefined) return;
      this._userWorkspaceCount.set(data.length);
    });
  }

  private stopWatchingUserWorkspaces(): void {
    if (this.userWorkspacesSubscription) {
      this.userWorkspacesSubscription();
      this.userWorkspacesSubscription = undefined;
    }
  }

  /**
   * Set the current workspace short ID (from URL)
   * This triggers fetching the full workspace by short ID
   */
  setWorkspaceShortId(shortId: string | null): void {
    const currentShortId = this._workspaceShortId();

    // Only set loading state if the short ID is actually changing
    // This prevents the loading state from getting stuck when navigating to the same workspace
    if (shortId && shortId !== currentShortId) {
      this._loadingWorkspace.set(true);
    }

    this._workspaceShortId.set(shortId);
  }

  /**
   * Set the current workspace ID directly (for backwards compatibility)
   */
  setWorkspaceId(workspaceId: string | null): void {
    this._workspaceId.set(workspaceId);
  }

  /**
   * Fetch workspace by short ID and set the full workspace ID
   */
  private async fetchWorkspaceByShortId(shortId: string): Promise<void> {
    try {
      const workspace = await this.convexService.getClient().query(api.workspaces.getWorkspaceByShortId, {
        shortId,
      });

      if (workspace) {
        // Set the full workspace ID, which will trigger the watch effect
        this._workspaceId.set(workspace._id);
        this._loadingWorkspace.set(false);
      } else {
        // Workspace not found - will be handled by redirect effect
        this._workspaceId.set(null);
        this._workspace.set(undefined);
        this._loadingWorkspace.set(false);
      }
    } catch {
      this._workspaceId.set(null);
      this._workspace.set(undefined);
      this._loadingWorkspace.set(false);
    }
  }

  private startWatchingWorkspace(workspaceId: string) {
    // Stop existing subscription if any
    this.stopWatchingWorkspace();

    try {
      // Use query directly to avoid type instantiation issues
      // TypeScript has issues with deep type inference for Convex queries
      const query = api.workspaces.getWorkspace;
      const queryArgs = { workspaceId: workspaceId as Id<'workspace'> };
      const watcher = this.convexService.watchQuery<WorkspaceQueryResult>(query, queryArgs);

      this.workspaceSubscription = watcher.subscribe((data) => {
        if (data !== undefined) {
          this._workspace.set(data);
        } else {
          // Query returned undefined - workspace might not exist anymore
          // Clear workspace data and let redirect effect handle navigation
          this._workspace.set(undefined);
          this._workspaceId.set(null);
        }
      });
    } catch (error) {
      // Error watching workspace - clear workspace data
      console.error('Error watching workspace:', error);
      this._workspace.set(undefined);
      this._workspaceId.set(null);
    }
  }

  private stopWatchingWorkspace() {
    if (this.workspaceSubscription) {
      this.workspaceSubscription();
      this.workspaceSubscription = undefined;
    }
  }

  async completeOnboarding(): Promise<void> {
    const workspaceId = this._workspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }
    await this.convexService.mutation(api.workspaces.completeWorkspaceOnboarding, {
      workspaceId: workspaceId as Id<'workspace'>,
    });
  }

  async updateTimezone(timezone: string): Promise<void> {
    const workspaceId = this._workspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }
    await this.convexService.mutation(api.workspaces.updateWorkspaceTimezone, {
      workspaceId: workspaceId as Id<'workspace'>,
      timezone,
    });
  }

  async updateExpectedMonthlyIncome(amount: bigint | null): Promise<void> {
    const workspaceId = this._workspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }
    await this.convexService.mutation(api.workspaces.updateWorkspaceExpectedMonthlyIncome, {
      workspaceId: workspaceId as Id<'workspace'>,
      expectedMonthlyIncome: amount,
    });
  }

  async updateCurrency(currency: string): Promise<void> {
    const workspaceId = this._workspaceId();
    if (!workspaceId) {
      throw new Error('No active workspace');
    }
    await this.convexService.mutation(api.workspaces.updateWorkspaceCurrency, {
      workspaceId: workspaceId as Id<'workspace'>,
      currency,
    });
  }
}
