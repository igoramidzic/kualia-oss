import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { UserPreferencesService } from '../../core/services/preferences/user-preferences.service';
import { BudgetSidebarToggleComponent } from './budget-sidebar-toggle.component';

describe('BudgetSidebarToggleComponent', () => {
  let component: BudgetSidebarToggleComponent;
  let fixture: ComponentFixture<BudgetSidebarToggleComponent>;
  let userPreferencesService: UserPreferencesService;

  beforeEach(() => {
    localStorage.clear();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [BudgetSidebarToggleComponent],
    });

    fixture = TestBed.createComponent(BudgetSidebarToggleComponent);
    component = fixture.componentInstance;
    userPreferencesService = TestBed.inject(UserPreferencesService);
  });

  describe('initialization', () => {
    it('should create the component', () => {
      expect(component).toBeTruthy();
    });

    it('should have icon defined', () => {
      expect(component['icon']).toBeDefined();
    });
  });

  describe('toggle', () => {
    it('should toggle sidebar from open to closed', () => {
      expect(userPreferencesService.budgetSidebarOpen()).toBe(true);

      component.toggle();

      expect(userPreferencesService.budgetSidebarOpen()).toBe(false);
    });

    it('should toggle sidebar from closed to open', () => {
      userPreferencesService.setBudgetSidebarOpen(false);

      component.toggle();

      expect(userPreferencesService.budgetSidebarOpen()).toBe(true);
    });

    it('should persist toggle state', () => {
      component.toggle();

      const stored = JSON.parse(localStorage.getItem('kualia-user-preferences') ?? '{}');
      expect(stored.budgetSidebarOpen).toBe(false);
    });
  });

  describe('template rendering', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should render a button', () => {
      const button = fixture.nativeElement.querySelector('button');
      expect(button).toBeTruthy();
    });

    it('should have correct aria-label when sidebar is open', () => {
      userPreferencesService.setBudgetSidebarOpen(true);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-label')).toBe('Close sidebar');
    });

    it('should have correct aria-label when sidebar is closed', () => {
      userPreferencesService.setBudgetSidebarOpen(false);
      fixture.detectChanges();

      const button = fixture.nativeElement.querySelector('button');
      expect(button.getAttribute('aria-label')).toBe('Open sidebar');
    });

    it('should render Nucleo icon', () => {
      const icon = fixture.nativeElement.querySelector('nucleo-icon');
      expect(icon).toBeTruthy();
    });

    it('should toggle sidebar when button is clicked', () => {
      expect(userPreferencesService.budgetSidebarOpen()).toBe(true);

      const button = fixture.nativeElement.querySelector('button');
      button.click();

      expect(userPreferencesService.budgetSidebarOpen()).toBe(false);
    });

    it('should toggle sidebar multiple times on repeated clicks', () => {
      const button = fixture.nativeElement.querySelector('button');

      expect(userPreferencesService.budgetSidebarOpen()).toBe(true);

      button.click();
      expect(userPreferencesService.budgetSidebarOpen()).toBe(false);

      button.click();
      expect(userPreferencesService.budgetSidebarOpen()).toBe(true);

      button.click();
      expect(userPreferencesService.budgetSidebarOpen()).toBe(false);
    });
  });

  describe('button styling', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should have ghost variant styling', () => {
      const button = fixture.nativeElement.querySelector('button');
      // The hlmBtn directive applies classes, check for expected classes
      // Default is open (true), so text-foreground should be applied
      expect(button.classList.contains('text-foreground')).toBe(true);
    });
  });
});
