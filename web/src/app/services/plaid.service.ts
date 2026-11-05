import { Injectable, inject, signal } from '@angular/core';
import { api } from 'convex/_generated/api';
import type { Id } from 'convex/_generated/dataModel';
import { toast } from 'ngx-sonner';
import { extractConvexErrorMessage } from '../shared/utils/convex-error-message';
import { ConvexService } from './convex.service';
import { ReportingService, TrackingEvent } from './reporting.service';
import { WorkspaceService } from './workspace.service';

// Plaid Link types for browser SDK
export interface PlaidLinkOptions {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit?: (error: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) => void;
  onLoad?: () => void;
  onEvent?: (eventName: string, metadata: PlaidLinkOnEventMetadata) => void;
}

export interface PlaidLinkOnSuccessMetadata {
  institution?: {
    name: string;
    institution_id: string;
  };
  accounts: {
    id: string;
    name: string;
    type: string;
    subtype: string;
    mask: string;
  }[];
  link_session_id: string;
}

export interface PlaidLinkOnExitMetadata {
  institution?: {
    name: string;
    institution_id: string;
  };
  status?: string;
  link_session_id: string;
  request_id: string;
}

export interface PlaidLinkOnEventMetadata {
  error_code?: string;
  error_message?: string;
  error_type?: string;
  exit_status?: string;
  institution_id?: string;
  institution_name?: string;
  link_session_id: string;
  timestamp: string;
}

export interface PlaidLinkError {
  error_type: string;
  error_code: string;
  error_message: string;
  display_message?: string;
}

interface PlaidLinkHandler {
  open: () => void;
  exit: () => void;
  destroy: () => void;
}

declare global {
  interface Window {
    Plaid: {
      create: (config: PlaidLinkOptions) => PlaidLinkHandler;
    };
  }
}

interface PlaidLinkTokenResponse {
  link_token: string;
  expiration?: string;
}

interface LinkNewPlaidItemResult {
  success: boolean;
  bankLinkId: string;
  institutionId: string;
  accountsLinked: number;
  accounts: {
    bankLinkAccountId: string;
    name: string;
    mask: string | null;
  }[];
}

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private readonly convexService = inject(ConvexService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly reportingService = inject(ReportingService);
  private linkHandler: PlaidLinkHandler | null = null;
  private readonly _loading = signal(false);
  readonly loading = this._loading.asReadonly();

  async createLinkToken(): Promise<string> {
    try {
      this._loading.set(true);
      const apiTyped = api as {
        bankProviders: {
          plaid: {
            createLinkToken: {
              createLinkToken: unknown;
            };
          };
        };
      };
      const result = await this.convexService.action<PlaidLinkTokenResponse>(
        apiTyped.bankProviders.plaid.createLinkToken.createLinkToken,
        {}
      );

      if (!result?.link_token) {
        throw new Error('No link token received');
      }

      return result.link_token;
    } catch (error) {
      console.error('Error creating link token:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to create link token'));
    } finally {
      this._loading.set(false);
    }
  }

  initializePlaidLink(
    linkToken: string,
    onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void,
    onExit?: (error: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) => void
  ): void {
    if (!window.Plaid) {
      throw new Error('Plaid SDK not loaded');
    }

    const config: PlaidLinkOptions = {
      token: linkToken,
      onSuccess,
      onExit:
        onExit ??
        (() => {
          // No-op callback
        }),
      onLoad: () => {
        // No-op callback
      },
      onEvent: () => {
        // No-op callback
      },
    };

    this.linkHandler = window.Plaid.create(config);
  }

  open(): void {
    if (!this.linkHandler) {
      throw new Error('Plaid Link not initialized');
    }
    this.linkHandler.open();
  }

  exit(): void {
    if (this.linkHandler) {
      this.linkHandler.exit();
    }
  }

  destroy(): void {
    if (this.linkHandler) {
      this.linkHandler.destroy();
      this.linkHandler = null;
    }
  }

  /**
   * Links a new Plaid item after successful authentication
   * @param publicToken The public token from Plaid Link
   * @param metadata The metadata from Plaid Link success callback
   * @returns The result of linking the Plaid item
   */
  async linkNewPlaidItem(publicToken: string, metadata: PlaidLinkOnSuccessMetadata): Promise<LinkNewPlaidItemResult> {
    try {
      this._loading.set(true);

      if (!metadata.institution) {
        throw new Error('Institution data is missing');
      }

      // Get workspace context
      const workspaceId = this.workspaceService.workspaceId();
      if (!workspaceId) {
        throw new Error('No workspace selected. Please select a workspace before connecting a bank account.');
      }

      // Get today's date in user's local timezone (YYYY-MM-DD format)
      const today = new Date();
      const initialBalanceDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

      const apiTyped = api as {
        bankProviders: {
          plaid: {
            linkNewPlaidItem: {
              linkNewPlaidItem: unknown;
            };
          };
        };
      };
      const result = await this.convexService.action<LinkNewPlaidItemResult>(
        apiTyped.bankProviders.plaid.linkNewPlaidItem.linkNewPlaidItem,
        {
          publicToken,
          institutionId: metadata.institution.institution_id,
          institutionName: metadata.institution.name,
          workspaceId: workspaceId as Id<'workspace'>,
          initialBalanceDate,
          accounts: metadata.accounts.map((account) => ({
            id: account.id,
            name: account.name,
            type: account.type,
            subtype: account.subtype,
            mask: account.mask,
          })),
        }
      );

      if (!result?.success) {
        throw new Error('Failed to link bank account');
      }

      this.reportingService.capture(TrackingEvent.BANK_LINK_CONNECTED);
      return result;
    } catch (error) {
      console.error('Error linking bank account:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to link bank account'));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Creates an update mode link token for reconnecting a bank link
   * @param bankLinkId The ID of the bank link to reconnect
   * @returns The link token for update mode
   */
  async createUpdateLinkToken(bankLinkId: string): Promise<string> {
    try {
      this._loading.set(true);
      const apiTyped = api as {
        bankProviders: {
          plaid: {
            createUpdateLinkToken: {
              createUpdateLinkToken: unknown;
            };
          };
        };
      };
      const result = await this.convexService.action<PlaidLinkTokenResponse>(
        apiTyped.bankProviders.plaid.createUpdateLinkToken.createUpdateLinkToken,
        { bankLinkId }
      );

      if (!result?.link_token) {
        throw new Error('No link token received');
      }

      return result.link_token;
    } catch (error) {
      console.error('Error creating update link token:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to create update link token'));
    } finally {
      this._loading.set(false);
    }
  }

  /**
   * Initiates the Plaid Link flow for connecting a new bank account
   */
  async initiateConnectionFlow(): Promise<void> {
    try {
      // Create link token
      const linkToken = await this.createLinkToken();

      // Initialize Plaid Link
      this.initializePlaidLink(
        linkToken,
        (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
          // On success, link the new Plaid item
          void this.linkNewPlaidItem(publicToken, metadata)
            .then(() => {
              this.destroy();
            })
            .catch((error: unknown) => {
              console.error('Error linking new Plaid item:', error);
              this.destroy();
              // Show toast error message
              const errorMessage = extractConvexErrorMessage(error, 'Failed to link bank account');
              toast.error(errorMessage, {
                duration: 6000,
              });
            });
        },
        (_error, _metadata) => {
          this.destroy();
        }
      );

      // Open Plaid Link
      this.open();
    } catch (error: unknown) {
      console.error('Error initiating connection flow:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to start bank connection'));
    }
  }

  /**
   * Reconnects a bank link using Plaid Link in update mode
   * @param bankLinkId The ID of the bank link to reconnect
   */
  async reconnectBankLink(bankLinkId: string): Promise<void> {
    try {
      // Create update mode link token
      const linkToken = await this.createUpdateLinkToken(bankLinkId);

      // Initialize Plaid Link in update mode
      this.initializePlaidLink(
        linkToken,
        () => {
          // On success, update the bank link status
          void this.handleUpdateModeSuccess(bankLinkId).then(() => {
            this.destroy();
          });
        },
        (_error, _metadata) => {
          this.destroy();
        }
      );

      // Open Plaid Link
      this.open();
    } catch (error: unknown) {
      console.error('Error reconnecting bank link:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to reconnect bank account'));
    }
  }

  /**
   * Handles successful reconnection in update mode
   * @param bankLinkId The ID of the bank link that was reconnected
   */
  private async handleUpdateModeSuccess(bankLinkId: string): Promise<void> {
    try {
      this._loading.set(true);

      const apiTyped = api as {
        bankProviders: {
          plaid: {
            handleUpdateModeSuccess: {
              handleUpdateModeSuccess: unknown;
            };
          };
        };
      };
      await this.convexService.action(apiTyped.bankProviders.plaid.handleUpdateModeSuccess.handleUpdateModeSuccess, {
        bankLinkId,
      });
      this.reportingService.capture(TrackingEvent.BANK_LINK_RECONNECTED);
    } catch (error) {
      console.error('Error handling update mode success:', error);
      throw new Error(extractConvexErrorMessage(error, 'Failed to reconnect bank account'));
    } finally {
      this._loading.set(false);
    }
  }
}
