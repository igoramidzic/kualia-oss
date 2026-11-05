import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import type { Id } from 'convex/_generated/dataModel';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BankConnectionService, type BankConnection } from '../../../services/bank-connection.service';
import { PlaidService } from '../../../services/plaid.service';
import { WorkspaceService } from '../../../services/workspace.service';
import { BankConnectionsComponent } from './bank-connections';

const ownedPlaidConnectionId = 'bank_link_owned' as Id<'bankLink'>;
const sharedPlaidConnectionId = 'bank_link_shared' as Id<'bankLink'>;
const ownedAppleWalletConnectionId = 'apple_wallet_connection_owned' as Id<'financeKitConnection'>;
const sharedAppleWalletConnectionId = 'apple_wallet_connection_shared' as Id<'financeKitConnection'>;
const appleWalletAccountId = 'apple_wallet_account_1' as Id<'financeKitAccount'>;

function createPlaidConnection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: ownedPlaidConnectionId,
    ref: {
      provider: 'plaid',
      connectionId: ownedPlaidConnectionId,
    },
    provider: 'plaid',
    displayName: 'Chase',
    logoUrl: null,
    primaryColor: null,
    status: 'connected',
    statusLabel: 'Connected',
    rawStatus: 'Healthy',
    lastSyncedAt: '2026-06-11T12:00:00.000Z',
    owner: {
      clerkId: 'clerk_owner',
      name: 'Igor',
      email: 'igor@example.com',
    },
    isOwnedByCurrentUser: true,
    canManageConnection: true,
    management: {
      type: 'kualia',
      label: 'Managed in Kualia',
    },
    accounts: [],
    ...overrides,
  } as BankConnection;
}

function createAppleWalletConnection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: ownedAppleWalletConnectionId,
    ref: {
      provider: 'apple_wallet',
      connectionId: ownedAppleWalletConnectionId,
    },
    provider: 'apple_wallet',
    displayName: 'Apple Wallet',
    logoUrl: null,
    primaryColor: null,
    status: 'connected',
    statusLabel: 'Connected',
    rawStatus: 'active',
    lastSyncedAt: '2026-06-11T12:00:00.000Z',
    owner: {
      clerkId: 'clerk_owner',
      name: 'Igor',
      email: 'igor@example.com',
    },
    isOwnedByCurrentUser: true,
    canManageConnection: true,
    management: {
      type: 'ios',
      label: 'Managed from iOS',
    },
    accounts: [
      {
        id: appleWalletAccountId,
        ref: {
          provider: 'apple_wallet',
          accountId: appleWalletAccountId,
        },
        name: 'Apple Card',
        accountType: 'credit_credit_card',
        accountNumberMask: null,
        initialBalance: null,
        currencyCode: 'USD',
        description: null,
        hasCompletedInitialSync: true,
        isLinked: true,
        linkedToBankAccount: {
          _id: 'bank_account_1' as Id<'bankAccount'>,
          name: 'Apple Card',
        },
      },
    ],
    ...overrides,
  } as BankConnection;
}

describe('BankConnectionsComponent', () => {
  let fixture: ComponentFixture<BankConnectionsComponent>;
  let connections: ReturnType<typeof signal<BankConnection[]>>;
  let reconnectSpy: ReturnType<typeof vi.fn>;
  let openDialogSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    connections = signal<BankConnection[]>([]);
    reconnectSpy = vi.fn().mockResolvedValue(undefined);
    openDialogSpy = vi.fn();

    const bankConnectionServiceMock = {
      connections: connections.asReadonly(),
      loading: signal(false).asReadonly(),
      disconnectConnection: vi.fn(),
    } as unknown as BankConnectionService;

    const workspaceServiceMock = {
      workspace: signal({ name: 'Family Budget' }).asReadonly(),
      workspaceShortId: signal('family').asReadonly(),
    } as unknown as WorkspaceService;

    await TestBed.configureTestingModule({
      imports: [BankConnectionsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: BankConnectionService, useValue: bankConnectionServiceMock },
        { provide: PlaidService, useValue: { reconnectBankLink: reconnectSpy } },
        { provide: HlmDialogService, useValue: { open: openDialogSpy } },
        { provide: WorkspaceService, useValue: workspaceServiceMock },
        { provide: HlmSidebarService, useValue: { toggleSidebar: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(BankConnectionsComponent);
  });

  it('separates owned and shared bank connections', () => {
    connections.set([
      createPlaidConnection(),
      createPlaidConnection({
        id: sharedPlaidConnectionId,
        ref: {
          provider: 'plaid',
          connectionId: sharedPlaidConnectionId,
        },
        status: 'pending',
        statusLabel: 'Pending',
        rawStatus: 'Pending',
        owner: {
          clerkId: 'clerk_member',
          name: 'Morgan',
          email: 'morgan@example.com',
        },
        isOwnedByCurrentUser: false,
        canManageConnection: false,
        displayName: 'Ally',
      }),
    ]);

    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="bank-connection-section-owned"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="bank-connection-section-shared"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Your connections');
    expect(fixture.nativeElement.textContent).toContain('Shared with you');
    expect(fixture.nativeElement.textContent).toContain('Shared by Morgan');
  });

  it('shows Apple Wallet connections in owned and shared sections', () => {
    connections.set([
      createAppleWalletConnection(),
      createAppleWalletConnection({
        id: sharedAppleWalletConnectionId,
        ref: {
          provider: 'apple_wallet',
          connectionId: sharedAppleWalletConnectionId,
        },
        owner: {
          clerkId: 'clerk_member',
          name: 'Morgan',
          email: 'morgan@example.com',
        },
        isOwnedByCurrentUser: false,
        canManageConnection: false,
      }),
    ]);

    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        `[data-testid="bank-connection-card-apple_wallet-${ownedAppleWalletConnectionId}"]`
      )
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        `[data-testid="bank-connection-card-apple_wallet-${sharedAppleWalletConnectionId}"]`
      )
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Apple Wallet');
    expect(fixture.nativeElement.textContent).toContain('Managed from iOS');
    expect(fixture.nativeElement.textContent).toContain('Linked to: Apple Card');
    expect(fixture.nativeElement.textContent).toContain('Shared by Morgan');
  });

  it('opens a disconnect dialog only for owned connections', () => {
    const ownedConnection = createAppleWalletConnection();
    const sharedConnection = createAppleWalletConnection({
      id: sharedAppleWalletConnectionId,
      ref: {
        provider: 'apple_wallet',
        connectionId: sharedAppleWalletConnectionId,
      },
      isOwnedByCurrentUser: false,
      canManageConnection: false,
    });
    connections.set([ownedConnection, sharedConnection]);
    fixture.detectChanges();

    fixture.componentInstance.disconnectConnection(sharedConnection);
    expect(openDialogSpy).not.toHaveBeenCalled();

    fixture.componentInstance.disconnectConnection(ownedConnection);
    expect(openDialogSpy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        context: {
          connection: ownedConnection.ref,
          provider: 'apple_wallet',
          displayName: 'Apple Wallet',
          accountCount: 1,
        },
      })
    );
  });

  it('opens account details with a connection account ref', () => {
    connections.set([createAppleWalletConnection()]);
    fixture.detectChanges();

    const accountRow = fixture.nativeElement.querySelector(
      `[data-testid="bank-connection-account-row-apple_wallet-${appleWalletAccountId}"]`
    ) as HTMLElement | null;
    accountRow?.click();

    expect(openDialogSpy).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        context: {
          connectionAccount: {
            provider: 'apple_wallet',
            accountId: appleWalletAccountId,
          },
        },
      })
    );
  });

  it('shows a management menu for owned connections and static status for shared connections', () => {
    connections.set([
      createPlaidConnection(),
      createPlaidConnection({
        id: sharedPlaidConnectionId,
        ref: {
          provider: 'plaid',
          connectionId: sharedPlaidConnectionId,
        },
        isOwnedByCurrentUser: false,
        canManageConnection: false,
      }),
    ]);

    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(`[data-testid="bank-connection-status-menu-plaid-${ownedPlaidConnectionId}"]`)
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        `[data-testid="bank-connection-status-static-plaid-${ownedPlaidConnectionId}"]`
      )
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        `[data-testid="bank-connection-status-menu-plaid-${sharedPlaidConnectionId}"]`
      )
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector(
        `[data-testid="bank-connection-status-static-plaid-${sharedPlaidConnectionId}"]`
      )
    ).not.toBeNull();
  });

  it('does not allow connection management methods for shared links', async () => {
    const sharedConnection = createPlaidConnection({
      id: sharedPlaidConnectionId,
      ref: {
        provider: 'plaid',
        connectionId: sharedPlaidConnectionId,
      },
      isOwnedByCurrentUser: false,
      canManageConnection: false,
    });
    connections.set([createPlaidConnection(), sharedConnection]);
    fixture.detectChanges();

    await fixture.componentInstance.reconnectConnection(sharedConnection);
    fixture.componentInstance.disconnectConnection(sharedConnection);

    expect(reconnectSpy).not.toHaveBeenCalled();
    expect(openDialogSpy).not.toHaveBeenCalled();
  });
});
