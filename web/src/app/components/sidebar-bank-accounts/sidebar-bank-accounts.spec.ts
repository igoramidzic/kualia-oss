import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BankAccountService, type BankAccountWithRelations } from '../../services/bank-account.service';
import { CurrencyService } from '../../services/currency.service';
import { IconService } from '../../services/icon.service';
import { WorkspaceService } from '../../services/workspace.service';
import { SidebarBankAccountsComponent } from './sidebar-bank-accounts';

@Component({
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TestRouteComponent {}

function createAccount(overrides: Partial<BankAccountWithRelations> = {}): BankAccountWithRelations {
  return {
    _id: 'account_12345678',
    _creationTime: Date.now(),
    name: 'Checking',
    accountType: 'banking_checking',
    currentBalance: 12345n,
    isClosed: false,
    isDeleted: false,
    visualIdentityMode: 'icon',
    resolvedLogoUrl: null,
    iconName: null,
    iconColorId: null,
    ...overrides,
  } as unknown as BankAccountWithRelations;
}

describe('SidebarBankAccountsComponent', () => {
  let fixture: ComponentFixture<SidebarBankAccountsComponent>;
  let setOpenMobile: ReturnType<typeof vi.fn>;
  let router: Router;

  beforeEach(async () => {
    const bankAccounts = signal<BankAccountWithRelations[]>([createAccount()]);
    setOpenMobile = vi.fn();

    await TestBed.configureTestingModule({
      imports: [SidebarBankAccountsComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([{ path: ':workspaceShortId/bank-accounts/:slug', component: TestRouteComponent }]),
        {
          provide: BankAccountService,
          useValue: {
            bankAccounts: bankAccounts.asReadonly(),
            hasAccounts: signal(true).asReadonly(),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            format: (amount: bigint) => `$${(Number(amount) / 100).toFixed(2)}`,
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            workspace: signal(undefined).asReadonly(),
            workspaceShortId: signal('test-workspace').asReadonly(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            getSidebarBankAccountGroupCollapsedState: vi.fn(() => false),
            setSidebarBankAccountGroupCollapsedState: vi.fn(),
            getSidebarNetWorthCardCollapsed: vi.fn(() => false),
            setSidebarNetWorthCardCollapsed: vi.fn(),
          },
        },
        {
          provide: IconService,
          useValue: {
            getIconByName: vi.fn(() => null),
          },
        },
        {
          provide: HlmSidebarService,
          useValue: {
            setOpenMobile,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SidebarBankAccountsComponent);
    router = TestBed.inject(Router);
    fixture.detectChanges();
  });

  it('renders account links as the same hlm button element used by page nav links', () => {
    const link = fixture.nativeElement.querySelector('a[hlmBtn]') as HTMLAnchorElement | null;

    expect(link).not.toBeNull();
    expect(link?.getAttribute('data-slot')).toBe('button');
    expect(link?.className).toContain('group/nav-item');
    expect(link?.className).toContain('w-full');
    expect(link?.textContent).toContain('Checking');
    expect(link?.textContent).toContain('$123.45');
  });

  it('includes the active workspace in account links', () => {
    const link = fixture.nativeElement.querySelector('a[hlmBtn]') as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe('/test-workspace/bank-accounts/checking-12345678');
  });

  it.each([
    '/test-workspace/bank-accounts/12345678',
    '/test-workspace/bank-accounts/checking-12345678',
    '/test-workspace/bank-accounts/renamed-account-12345678',
  ])('highlights the account for the stable short ID in %s', async (url) => {
    await router.navigateByUrl(url);
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a[hlmBtn]') as HTMLAnchorElement;
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(link.classList.contains('bg-accent/50')).toBe(true);
  });

  it('does not highlight the account on a different account route', async () => {
    await router.navigateByUrl('/test-workspace/bank-accounts/87654321');
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('a[hlmBtn]') as HTMLAnchorElement;
    expect(link.hasAttribute('aria-current')).toBe(false);
    expect(link.classList.contains('bg-accent/50')).toBe(false);
  });

  it('adds vertical spacing between account groups', () => {
    const groupContainer = fixture.nativeElement.querySelector('.flex.flex-col') as HTMLElement | null;

    expect(groupContainer?.className).toContain('gap-2');
  });

  it('renders sidebar currency amounts with the mono font utility', () => {
    const amountSpans = Array.from(fixture.nativeElement.querySelectorAll('span.tabular-nums'));

    expect(amountSpans).toHaveLength(5);
    expect(amountSpans.every((span) => span.classList.contains('font-mono'))).toBe(true);
  });

  it('closes the mobile sidebar when an account link is clicked', async () => {
    const link = fixture.nativeElement.querySelector('a[hlmBtn]') as HTMLAnchorElement;

    link.click();
    await fixture.whenStable();

    expect(setOpenMobile).toHaveBeenCalledWith(false);
  });
});
