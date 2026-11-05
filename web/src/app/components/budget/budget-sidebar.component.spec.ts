import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BudgetSidebarComponent } from './budget-sidebar.component';

describe('BudgetSidebarComponent', () => {
  let component: BudgetSidebarComponent;
  let fixture: ComponentFixture<BudgetSidebarComponent>;
  let userPreferencesService: UserPreferencesService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetSidebarComponent],
    });

    fixture = TestBed.createComponent(BudgetSidebarComponent);
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
    it('should reflect userPreferencesService budgetSidebarOpen state', () => {
      expect(component['isOpen']()).toBe(true);

      userPreferencesService.setBudgetSidebarOpen(false);
      expect(component['isOpen']()).toBe(false);

      userPreferencesService.setBudgetSidebarOpen(true);
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
      userPreferencesService.setBudgetSidebarOpen(false);
      const classes = component['sidebarClasses']();

      expect(classes).toContain('translate-x-full');
      expect(classes).not.toContain('translate-x-0');
    });

    it('should include translate-x-0 when open', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      const classes = component['sidebarClasses']();

      expect(classes).toContain('translate-x-0');
      expect(classes).not.toContain('translate-x-full');
    });
  });

  describe('close', () => {
    it('should set sidebar to closed', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      expect(component['isOpen']()).toBe(true);

      component.close();

      expect(component['isOpen']()).toBe(false);
    });

    it('should persist closed state', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      component.close();

      const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
      expect(stored.budgetSidebarOpen).toBe(false);
    });
  });

  describe('aria-hidden attribute', () => {
    it('should be true when sidebar is closed', () => {
      userPreferencesService.setBudgetSidebarOpen(false);
      fixture.detectChanges();

      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside.getAttribute('aria-hidden')).toBe('true');
    });

    it('should be false when sidebar is open', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      fixture.detectChanges();

      const aside = fixture.nativeElement.querySelector('aside');
      expect(aside.getAttribute('aria-hidden')).toBe('false');
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

    it('should render quick assign card', () => {
      const content = fixture.nativeElement.querySelector('.flex-1.overflow-y-auto');
      expect(content).toBeTruthy();
      expect(content.textContent).toContain('Quick Assign');
    });

    it('should close sidebar when close button is clicked', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      fixture.detectChanges();

      const closeButton = fixture.nativeElement.querySelector('button[aria-label="Close sidebar"]');
      closeButton.click();

      expect(component['isOpen']()).toBe(false);
    });
  });
});
