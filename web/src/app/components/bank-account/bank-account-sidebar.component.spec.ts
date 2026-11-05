import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BankAccountSidebarComponent } from './bank-account-sidebar.component';

describe('BankAccountSidebarComponent', () => {
  let component: BankAccountSidebarComponent;
  let fixture: ComponentFixture<BankAccountSidebarComponent>;
  let userPreferencesService: UserPreferencesService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BankAccountSidebarComponent],
    });

    fixture = TestBed.createComponent(BankAccountSidebarComponent);
    component = fixture.componentInstance;
    userPreferencesService = TestBed.inject(UserPreferencesService);
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should have close icon defined', () => {
      expect(component['closeIcon']).toBeDefined();
    });
  });

  describe('isOpen', () => {
    it('should reflect userPreferencesService bankAccountSidebarOpen state', () => {
      expect(component['isOpen']()).toBe(true);

      userPreferencesService.setBankAccountSidebarOpen(false);
      expect(component['isOpen']()).toBe(false);

      userPreferencesService.setBankAccountSidebarOpen(true);
      expect(component['isOpen']()).toBe(true);
    });
  });

  describe('sidebarClasses', () => {
    it('should include base positioning classes', () => {
      const classes = component['sidebarClasses']();

      expect(classes).toContain('absolute');
      expect(classes).toContain('right-0');
      expect(classes).toContain('top-0');
      expect(classes).toContain('h-full');
      expect(classes).toContain('w-80');
      expect(classes).toContain('z-20');
    });

    it('should include styling classes', () => {
      const classes = component['sidebarClasses']();

      expect(classes).toContain('bg-content-background');
      expect(classes).toContain('border-l');
    });

    it('should include transition classes', () => {
      // Enable transitions (normally done via afterNextRender)
      component['transitionsEnabled'].set(true);
      fixture.detectChanges();

      const classes = component['sidebarClasses']();

      expect(classes).toContain('transition-transform');
      expect(classes).toContain('duration-200');
      expect(classes).toContain('ease-in-out');
    });

    it('should include translate-x-full when closed', () => {
      userPreferencesService.setBankAccountSidebarOpen(false);
      const classes = component['sidebarClasses']();

      expect(classes).toContain('translate-x-full');
      expect(classes).not.toContain('translate-x-0');
    });

    it('should include translate-x-0 when open', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      const classes = component['sidebarClasses']();

      expect(classes).toContain('translate-x-0');
      expect(classes).not.toContain('translate-x-full');
    });
  });

  describe('close', () => {
    it('should set sidebar to closed', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      expect(component['isOpen']()).toBe(true);

      component.close();

      expect(component['isOpen']()).toBe(false);
    });

    it('should persist closed state', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      component.close();

      const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
      expect(stored.bankAccountSidebarOpen).toBe(false);
    });
  });

  describe('aria-hidden attribute', () => {
    it('should be false when sidebar is open', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      fixture.detectChanges();

      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside.getAttribute('aria-hidden')).toBe('false');
    });

    it('should be true when sidebar is closed', () => {
      userPreferencesService.setBankAccountSidebarOpen(false);
      // Enable transitions so the component renders even when closed
      component['transitionsEnabled'].set(true);
      fixture.detectChanges();

      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should render header with title', () => {
      const header = fixture.nativeElement.querySelector('.flex.h-10');
      expect(header).toBeTruthy();
      expect(header.textContent).toContain('Details');
    });

    it('should render close button', () => {
      const closeButton = fixture.nativeElement.querySelector('button[aria-label="Close sidebar"]');
      expect(closeButton).toBeTruthy();
    });

    it('should render placeholder content', () => {
      const content = fixture.nativeElement.querySelector('.flex-1.overflow-y-auto');
      expect(content).toBeTruthy();
      expect(content.textContent).toContain('Coming soon');
    });

    it('should close sidebar when close button is clicked', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      fixture.detectChanges();

      const closeButton = fixture.nativeElement.querySelector('button[aria-label="Close sidebar"]');
      closeButton.click();

      expect(component['isOpen']()).toBe(false);
    });
  });

  describe('shouldRender', () => {
    it('should render when sidebar is open', () => {
      userPreferencesService.setBankAccountSidebarOpen(true);
      expect(component['shouldRender']()).toBe(true);
    });

    it('should render when transitions are enabled (even if closed)', () => {
      userPreferencesService.setBankAccountSidebarOpen(false);
      component['transitionsEnabled'].set(true);
      expect(component['shouldRender']()).toBe(true);
    });

    it('should not render when closed and transitions not enabled', () => {
      userPreferencesService.setBankAccountSidebarOpen(false);
      component['transitionsEnabled'].set(false);
      expect(component['shouldRender']()).toBe(false);
    });
  });
});
