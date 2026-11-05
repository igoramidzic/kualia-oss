import { inject, Injectable } from '@angular/core';
import { NavigationExtras, Router } from '@angular/router';
import { getShortId } from '../shared/utils/id-utils';
import { WorkspaceService } from './workspace.service';

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private readonly router = inject(Router);
  private readonly workspaceService = inject(WorkspaceService);

  /**
   * Navigate to a workspace-aware route
   * @param path - The path segments without the workspace short ID
   * @param extras - Optional navigation extras
   */
  async navigateToWorkspace(path: string[], extras?: NavigationExtras): Promise<boolean> {
    const workspaceShortId = this.workspaceService.workspaceShortId();

    if (!workspaceShortId) {
      // If no workspace, navigate to root
      return this.router.navigate(['/'], extras);
    }

    // Prepend workspace short ID to the path
    const fullPath = [workspaceShortId, ...path];
    return this.router.navigate(fullPath, extras);
  }

  /**
   * Navigate to bank accounts list
   */
  async navigateToBankAccounts(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['bank-accounts'], extras);
  }

  /**
   * Navigate to a specific bank account
   */
  async navigateToBankAccount(slug: string, extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['bank-accounts', slug], extras);
  }

  /**
   * Navigate to bank connections settings
   */
  async navigateToBankConnections(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['settings', 'bank-connections'], extras);
  }

  /**
   * Navigate to transactions list
   */
  async navigateToTransactions(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['transactions'], extras);
  }

  /**
   * Navigate to budget page
   */
  async navigateToBudget(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['budget'], extras);
  }

  /**
   * Navigate to a specific transaction using full ID
   */
  async navigateToTransaction(id: string, page = 'details', extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['transactions', id, page], extras);
  }

  /**
   * Get the route segments for transactions list
   * Returns absolute route segments that can be used with [routerLink]
   */
  getTransactionsRoute(): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    return ['/', workspaceShortId, 'transactions'];
  }

  /**
   * Get the route segments for a specific transaction
   * Returns absolute route segments that can be used with [routerLink]
   */
  getTransactionRoute(id: string, page = 'details'): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    return ['/', workspaceShortId, 'transactions', id, page];
  }

  getBankConnectionsRoute(): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    return ['/', workspaceShortId, 'settings', 'bank-connections'];
  }

  /**
   * Get the route segments for a specific bank account
   * Returns absolute route segments that can be used with [routerLink]
   */
  getBankAccountRoute(id: string): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    const shortId = getShortId(id);
    return ['/', workspaceShortId, 'bank-accounts', shortId];
  }

  /**
   * Navigate to a specific item using short ID (last 8 chars)
   * Generic method for any item type that uses ID-based routing
   */
  async navigateToItem(
    itemType: 'transactions' | 'bank-accounts' | 'subscriptions',
    id: string,
    page?: string,
    extras?: NavigationExtras
  ): Promise<boolean> {
    const shortId = getShortId(id);
    const pathSegments = page ? [itemType, shortId, page] : [itemType, shortId];
    return this.navigateToWorkspace(pathSegments, extras);
  }

  /**
   * Navigate to subscriptions list
   */
  async navigateToSubscriptions(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['subscriptions'], extras);
  }

  /**
   * Navigate to a specific subscription using short ID (last 8 chars)
   */
  async navigateToSubscription(id: string, page = 'details', extras?: NavigationExtras): Promise<boolean> {
    const shortId = getShortId(id);
    return this.navigateToWorkspace(['subscriptions', shortId, page], extras);
  }

  /**
   * Navigate to a specific planned (scheduled) transaction using its full ID (the detail
   * page fetches by full Id<'scheduledTransaction'>, mirroring the transactions detail route).
   */
  async navigateToPlannedTransaction(id: string, page = 'details', extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['planned', id, page], extras);
  }

  /**
   * Get the route segments for a specific planned (scheduled) transaction (for [routerLink]).
   */
  getPlannedTransactionRoute(id: string, page = 'details'): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    return ['/', workspaceShortId, 'planned', id, page];
  }

  /**
   * Navigate to runway
   */
  async navigateToRunway(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['runway'], extras);
  }

  /**
   * Navigate to reports
   */
  async navigateToReports(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['reports'], extras);
  }

  /**
   * Navigate to settings
   */
  async navigateToSettings(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['settings'], extras);
  }

  /**
   * Navigate to settings - connected accounts
   */
  async navigateToSettingsConnectedAccounts(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['settings', 'bank-connections'], extras);
  }

  /**
   * Navigate to merchants list
   */
  async navigateToMerchants(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['settings', 'merchants'], extras);
  }

  /**
   * Navigate to the planned transactions page
   */
  async navigateToPlanned(extras?: NavigationExtras): Promise<boolean> {
    return this.navigateToWorkspace(['planned'], extras);
  }

  /**
   * Get the route segments for the planned transactions page
   * Returns absolute route segments that can be used with [routerLink]
   */
  getPlannedRoute(): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    return ['/', workspaceShortId, 'planned'];
  }

  /**
   * Get the route segments for a specific merchant
   * Returns absolute route segments that can be used with [routerLink]
   */
  getMerchantRoute(id: string, page = 'details'): string[] {
    const workspaceShortId = this.workspaceService.workspaceShortId();
    if (!workspaceShortId) {
      return ['/'];
    }
    const shortId = getShortId(id);
    return ['/', workspaceShortId, 'settings', 'merchants', shortId, page];
  }
}
