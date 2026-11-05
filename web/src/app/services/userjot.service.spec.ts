import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ENVIRONMENT, type Environment } from '../config/environment.token';
import { UserPreferencesService } from '../core/services/preferences/user-preferences.service';
import { ConvexService } from './convex.service';
import { UserJotService } from './userjot.service';

// Mock Convex API
vi.mock('../../../convex/_generated/api', () => ({
  api: {
    userjot: {
      generateIdentityToken: vi.fn(),
    },
  },
}));

// Mock window.uj object - created once and cleared between tests
const mockWindowUj = {
  init: vi.fn(),
  identify: vi.fn().mockResolvedValue({
    viewer: { id: 'user-123', email: 'test@example.com' },
    identityTrust: 'signed',
    warnings: [],
  }),
  logout: vi.fn(),
  open: vi.fn(),
  setTheme: vi.fn(),
  getState: vi.fn(() => ({ unreadCount: 0, widget: { open: false } })),
  on: vi.fn(() => vi.fn()),
};

describe('UserJotService', () => {
  let service: UserJotService;
  let mockUserPreferencesService: {
    theme: ReturnType<typeof signal<'light' | 'dark' | 'system'>>;
  };
  let mockConvexService: {
    isAuthenticated: ReturnType<typeof vi.fn>;
    ensureCurrentUserProfile: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
  };
  let mockConvexClient: {
    query: ReturnType<typeof vi.fn>;
  };
  let mockEnvironment: Environment;
  let isConvexAuthenticated: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    // Clear mock call history but keep the same mock functions
    vi.clearAllMocks();

    // Create mock environment for testing
    mockEnvironment = {
      production: false,
      posthog: {
        apiKey: '',
        apiHost: '',
      },
      userjot: {
        projectId: 'test-project-id',
      },
      convex: {
        url: 'https://test.convex.cloud',
        siteUrl: 'https://test.convex.site',
      },
      clerk: {
        publishableKey: 'pk_test_mock',
      },
      logoDev: {
        token: 'pk_mock',
      },
    };

    // Set up window.uj directly (not global.window)
    (window as unknown as { uj: typeof mockWindowUj }).uj = mockWindowUj;

    // Create mock Convex client
    mockConvexClient = {
      query: vi.fn(),
    };

    // Create mock ConvexService
    isConvexAuthenticated = signal(false);
    mockConvexService = {
      isAuthenticated: vi.fn(() => isConvexAuthenticated()),
      ensureCurrentUserProfile: vi.fn().mockResolvedValue(undefined),
      getClient: vi.fn(() => mockConvexClient),
    };

    // Create mock UserPreferencesService with signal
    const themeSignal = signal<'light' | 'dark' | 'system'>('system');
    mockUserPreferencesService = {
      theme: themeSignal,
    };

    // Reset and configure TestBed
    TestBed.resetTestingModule();

    // Configure with zoneless change detection for effects to work
    // Provide mock ConvexService so injector.get(ConvexService) returns our mock
    // Don't mock Injector - Angular needs the real one for effect scheduler
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        UserJotService,
        { provide: UserPreferencesService, useValue: mockUserPreferencesService },
        { provide: ConvexService, useValue: mockConvexService },
        { provide: ENVIRONMENT, useValue: mockEnvironment },
      ],
    });

    // Inject service - TestBed.inject() properly initializes the effect scheduler
    service = TestBed.inject(UserJotService);

    // Reset service's initialized state to ensure clean test state
    // This is important because the service is a singleton and may retain state
    (service as unknown as { initialized: boolean }).initialized = false;
  });

  describe('init()', () => {
    it('DEBUG: window.uj should be accessible', () => {
      // Debug test to check window.uj accessibility
      expect(typeof window).toBe('object');
      expect(window.uj).toBeDefined();
      expect(window.uj.init).toBeDefined();
      expect(typeof window.uj.init).toBe('function');
    });

    it('should initialize UserJot when projectId is configured and window.uj exists', () => {
      service.init();

      expect(mockWindowUj.init).toHaveBeenCalledWith('test-project-id', {
        widget: {
          launcher: false,
          position: 'left',
          theme: 'auto', // system maps to auto
        },
        pageContext: 'origin',
        onReady: expect.any(Function),
      });
    });

    it('should not initialize if already initialized', () => {
      service.init();
      mockWindowUj.init.mockClear();

      service.init();

      expect(mockWindowUj.init).not.toHaveBeenCalled();
    });

    it('should not initialize if projectId is missing', () => {
      // Set mockEnvironment with empty projectId BEFORE creating the service
      mockEnvironment.userjot = {
        projectId: '',
      };

      // Recreate the service with the modified environment
      // Reset TestBed and create a new service instance
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideZonelessChangeDetection(),
          UserJotService,
          { provide: UserPreferencesService, useValue: mockUserPreferencesService },
          { provide: ConvexService, useValue: mockConvexService },
          { provide: ENVIRONMENT, useValue: mockEnvironment },
        ],
      });
      const testService = TestBed.inject(UserJotService);

      testService.init();

      expect(mockWindowUj.init).not.toHaveBeenCalled();
    });

    it('should handle missing window.uj gracefully', () => {
      // Temporarily remove uj from window
      const originalUj = (window as unknown as { uj?: typeof mockWindowUj }).uj;
      delete (window as unknown as { uj?: typeof mockWindowUj }).uj;

      expect(() => service.init()).not.toThrow();
      expect(mockWindowUj.init).not.toHaveBeenCalled();

      // Restore for other tests
      if (originalUj) {
        (window as unknown as { uj: typeof mockWindowUj }).uj = originalUj;
      }
    });

    it('authenticates after both the widget and Convex authentication are ready', async () => {
      mockConvexClient.query.mockResolvedValue({ token: 'signed-jwt' });
      service.init();
      const initOptions = mockWindowUj.init.mock.calls[0]?.[1];

      initOptions?.onReady?.();
      TestBed.flushEffects();
      expect(mockWindowUj.identify).not.toHaveBeenCalled();

      isConvexAuthenticated.set(true);
      TestBed.flushEffects();
      await vi.waitFor(() => expect(mockWindowUj.identify).toHaveBeenCalledWith({ token: 'signed-jwt' }));

      expect(mockConvexService.ensureCurrentUserProfile).toHaveBeenCalledOnce();
      expect(service.identityTrust()).toBe('signed');

      mockWindowUj.logout.mockClear();
      isConvexAuthenticated.set(false);
      TestBed.flushEffects();

      expect(mockWindowUj.logout).toHaveBeenCalledOnce();
      expect(service.identityTrust()).toBeNull();
    });
  });

  describe('setTheme()', () => {
    it('should not call if widget not initialized', () => {
      service.setTheme('dark');
      expect(mockWindowUj.setTheme).not.toHaveBeenCalled();
    });

    it('should not call if window.uj is undefined', () => {
      const originalUj = (window as unknown as { uj?: typeof mockWindowUj }).uj;
      delete (window as unknown as { uj?: typeof mockWindowUj }).uj;

      service.setTheme('dark');

      expect(mockWindowUj.setTheme).not.toHaveBeenCalled();

      // Restore for other tests
      if (originalUj) {
        (window as unknown as { uj: typeof mockWindowUj }).uj = originalUj;
      }
    });
  });

  describe('identify()', () => {
    it('should not call if widget not initialized', async () => {
      await service.identify({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      expect(mockWindowUj.identify).not.toHaveBeenCalled();
    });

    it('should not call if window.uj is undefined', async () => {
      const originalUj = (window as unknown as { uj?: typeof mockWindowUj }).uj;
      delete (window as unknown as { uj?: typeof mockWindowUj }).uj;

      await service.identify({
        user: { id: 'user-123', email: 'test@example.com' },
      });

      expect(mockWindowUj.identify).not.toHaveBeenCalled();

      // Restore for other tests
      if (originalUj) {
        (window as unknown as { uj: typeof mockWindowUj }).uj = originalUj;
      }
    });
  });

  describe('identifyUser()', () => {
    beforeEach(() => {
      // Initialize widget for identifyUser tests
      service.init();
      const initOptions = mockWindowUj.init.mock.calls[0]?.[1];
      initOptions?.onReady?.();
    });

    it('should skip if widget not initialized', async () => {
      // Reset initialization
      (service as unknown as { initialized: boolean }).initialized = false;

      await service.identifyUser();

      expect(mockConvexService.isAuthenticated).not.toHaveBeenCalled();
      expect(mockWindowUj.identify).not.toHaveBeenCalled();
    });

    it('should skip if user not authenticated', async () => {
      await service.identifyUser();

      expect(mockConvexClient.query).not.toHaveBeenCalled();
      expect(mockWindowUj.identify).not.toHaveBeenCalled();
    });

    it('should identify user with the signed token from Convex', async () => {
      isConvexAuthenticated.set(true);
      mockConvexClient.query.mockResolvedValue({ token: 'signed-jwt' });

      await service.identifyUser();

      expect(mockConvexService.ensureCurrentUserProfile).toHaveBeenCalledOnce();
      expect(mockConvexClient.query).toHaveBeenCalled();
      expect(mockWindowUj.identify).toHaveBeenCalledWith({ token: 'signed-jwt' });
      expect(service.identityTrust()).toBe('signed');
    });

    it('should handle missing token gracefully', async () => {
      isConvexAuthenticated.set(true);
      mockConvexClient.query.mockResolvedValue({});

      await service.identifyUser();

      expect(mockConvexClient.query).toHaveBeenCalled();
      expect(mockWindowUj.identify).not.toHaveBeenCalled();
    });

    it('does not report an unsigned identity as authenticated', async () => {
      isConvexAuthenticated.set(true);
      mockConvexClient.query.mockResolvedValue({ token: 'signed-jwt' });
      mockWindowUj.identify.mockResolvedValueOnce({
        viewer: { id: 'user-123' },
        identityTrust: 'unsigned',
        warnings: [],
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      await service.identifyUser();

      expect(service.identityTrust()).toBeNull();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('open()', () => {
    it('should open the widget home', () => {
      service.init();

      service.open();

      expect(mockWindowUj.open).toHaveBeenCalledWith({ to: 'home' });
    });

    it('should not call if widget not initialized', () => {
      service.open();
      expect(mockWindowUj.open).not.toHaveBeenCalled();
    });
  });

  describe('logout()', () => {
    it('should not call if widget not initialized', () => {
      service.logout();
      expect(mockWindowUj.logout).not.toHaveBeenCalled();
    });

    it('should not call if window.uj is undefined', () => {
      const originalUj = (window as unknown as { uj?: typeof mockWindowUj }).uj;
      delete (window as unknown as { uj?: typeof mockWindowUj }).uj;

      service.logout();

      expect(mockWindowUj.logout).not.toHaveBeenCalled();

      // Restore for other tests
      if (originalUj) {
        (window as unknown as { uj: typeof mockWindowUj }).uj = originalUj;
      }
    });
  });

  describe('unread count', () => {
    it('should read the initial count and react to unread events when ready', () => {
      mockWindowUj.getState.mockReturnValue({ unreadCount: 2, widget: { open: false } });
      service.init();
      const initOptions = mockWindowUj.init.mock.calls[0]?.[1];

      initOptions?.onReady?.();

      expect(service.unreadCount()).toBe(2);
      const unreadListener = mockWindowUj.on.mock.calls[0]?.[1];
      unreadListener?.({ count: 5 });
      expect(service.unreadCount()).toBe(5);
    });
  });

  describe('open state', () => {
    it('tracks the initial widget state and subsequent open and close events', () => {
      mockWindowUj.getState.mockReturnValue({ unreadCount: 0, widget: { open: true } });
      service.init();
      const initOptions = mockWindowUj.init.mock.calls[0]?.[1];

      initOptions?.onReady?.();

      expect(service.isOpen()).toBe(true);
      const closeListener = mockWindowUj.on.mock.calls.find(([event]) => event === 'close')?.[1];
      closeListener?.();
      expect(service.isOpen()).toBe(false);

      const openListener = mockWindowUj.on.mock.calls.find(([event]) => event === 'open')?.[1];
      openListener?.();
      expect(service.isOpen()).toBe(true);
    });
  });

  describe('theme synchronization', () => {
    it('should not update theme when preferences change before initialization', async () => {
      mockUserPreferencesService.theme.set('dark');

      // Wait a tick to ensure effects have run
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Theme change before init should not trigger setTheme
      expect(mockWindowUj.setTheme).not.toHaveBeenCalled();
    });
  });
});
