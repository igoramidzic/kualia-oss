import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import { extractConvexErrorMessage } from '../shared/utils/convex-error-message';
import { RuleActions, RuleConditions, TransactionRule } from '../types/transaction-rule.types';
import { ConvexService } from './convex.service';
import { WorkspaceService } from './workspace.service';

@Injectable({
  providedIn: 'root',
})
export class RuleService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly _rules = signal<TransactionRule[]>([]);
  private readonly _loading = signal<boolean>(false);
  private readonly _hasLoaded = signal<boolean>(false);
  private readonly _error = signal<string | null>(null);

  private ruleSubscription?: () => void;

  // Public read-only signals
  readonly rules = this._rules.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly hasLoaded = this._hasLoaded.asReadonly();
  readonly error = this._error.asReadonly();

  // Computed values
  readonly totalRules = computed(() => this._rules().length);
  readonly hasRules = computed(() => this._rules().length > 0);
  readonly activeRules = computed(() => this._rules().filter((rule) => rule.isActive && !rule.isDeleted));

  constructor() {
    // Start watching rules when authenticated AND workspace is available
    effect(() => {
      const hasWorkspace = !!this.workspaceService.workspaceId();
      if (this.convexService.isAuthenticated() && hasWorkspace) {
        this.startWatchingRules();
      } else {
        this.stopWatchingRules();
        this._rules.set([]);
        this._hasLoaded.set(false);
      }
    });

    // Clean up on destroy
    this.destroyRef.onDestroy(() => {
      this.stopWatchingRules();
    });
  }

  /**
   * Start watching rules with real-time updates
   */
  private startWatchingRules() {
    this.stopWatchingRules();

    this._loading.set(true);
    this._error.set(null);

    try {
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._loading.set(false);
        return;
      }

      const queryArgs = {
        workspaceId: workspaceId as Id<'workspace'>,
        includeDeleted: false,
      };

      const watcher = this.convexService.watchQuery<TransactionRule[]>(api.transactionRules.listRules, queryArgs);

      this.ruleSubscription = watcher.subscribe((rules) => {
        if (rules !== undefined) {
          this._rules.set(rules);
          this._loading.set(false);
          this._hasLoaded.set(true);
        }
      });
    } catch (error) {
      console.error('Error watching rules:', error);
      this._error.set('Failed to load rules');
      this._loading.set(false);
    }
  }

  /**
   * Stop watching rules
   */
  private stopWatchingRules() {
    if (this.ruleSubscription) {
      this.ruleSubscription();
      this.ruleSubscription = undefined;
    }
  }

  /**
   * Create a new rule
   */
  async createRule(rule: {
    name: string;
    isActive: boolean;
    conditions: RuleConditions;
    actions: RuleActions;
  }): Promise<Id<'transactionRule'> | null> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return null;
      }

      const result = await this.convexService.mutation<Id<'transactionRule'>>(api.transactionRules.createRule, {
        workspaceId: workspaceId as Id<'workspace'>,
        name: rule.name,
        isActive: rule.isActive,
        conditions: rule.conditions,
        actions: {
          setMerchantId: rule.actions.setMerchantId as Id<'merchant'> | undefined,
          setCategoryId: rule.actions.setCategoryId as Id<'category'> | undefined,
        },
      });
      return result;
    } catch (error) {
      console.error('Error creating rule:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to create rule'));
    }
  }

  /**
   * Update an existing rule
   */
  async updateRule(
    ruleId: Id<'transactionRule'>,
    updates: {
      name?: string;
      isActive?: boolean;
      conditions?: RuleConditions;
      actions?: RuleActions;
    }
  ): Promise<void> {
    this._error.set(null);
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }
    try {
      await this.convexService.mutation(api.transactionRules.updateRule, {
        workspaceId: workspaceId as Id<'workspace'>,
        id: ruleId,
        ...updates,
        actions: updates.actions
          ? {
              setMerchantId: updates.actions.setMerchantId as Id<'merchant'> | undefined,
              setCategoryId: updates.actions.setCategoryId as Id<'category'> | undefined,
            }
          : undefined,
      });
    } catch (error: unknown) {
      throw new Error(extractConvexErrorMessage(error, 'Failed to update rule'));
    }
  }

  /**
   * Delete a rule (soft delete)
   */
  async deleteRule(ruleId: Id<'transactionRule'>): Promise<boolean> {
    try {
      this._error.set(null);
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        this._error.set('No workspace selected');
        return false;
      }
      await this.convexService.mutation(api.transactionRules.deleteRule, {
        workspaceId: workspaceId as Id<'workspace'>,
        id: ruleId,
      });
      return true;
    } catch (error) {
      console.error('Error deleting rule:', error);
      this._error.set('Failed to delete rule');
      return false;
    }
  }

  /**
   * Count how many transactions would match the given conditions
   */
  async countMatchingTransactions(conditions: RuleConditions): Promise<number> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      return 0;
    }
    try {
      const count = await this.convexService.getClient().query(api.transactionRules.countMatchingTransactions, {
        workspaceId: workspaceId as Id<'workspace'>,
        conditions,
      });
      return count;
    } catch (error) {
      console.error('Error counting matching transactions:', error);
      return 0;
    }
  }

  /**
   * Apply a rule to all existing transactions that match
   */
  async applyToExisting(ruleId: Id<'transactionRule'>): Promise<number> {
    const workspaceId = this.workspaceService.workspaceId();
    if (!workspaceId) {
      throw new Error('No workspace selected');
    }
    try {
      const appliedCount = await this.convexService.mutation<number>(api.transactionRules.applyRuleToExisting, {
        workspaceId: workspaceId as Id<'workspace'>,
        id: ruleId,
      });
      return appliedCount;
    } catch (error: unknown) {
      throw new Error(extractConvexErrorMessage(error, 'Failed to apply rule to existing transactions'));
    }
  }

  /**
   * Clear error state
   */
  clearError() {
    this._error.set(null);
  }

  /**
   * Refresh rules manually
   */
  refresh() {
    this.startWatchingRules();
  }
}
