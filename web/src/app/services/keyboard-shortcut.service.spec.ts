import { Location } from '@angular/common';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferencesService } from '../core/services/preferences/user-preferences.service';
import { Command } from '../shared/models/command.model';
import { AiChatService } from './ai-chat.service';
import { AuthService } from './auth.service';
import { BudgetCategorySelectionService } from './budget-category-selection.service';
import { CommandMenuService } from './command-menu.service';
import { CommandRegistryService } from './command-registry.service';
import { KeyboardShortcutService } from './keyboard-shortcut.service';
import { TransactionSelectionService } from './transaction-selection.service';
import { UndoRedoService } from './undo-redo.service';
import { UserJotService } from './userjot.service';
import { WorkspaceService } from './workspace.service';

describe('KeyboardShortcutService', () => {
  let service: KeyboardShortcutService;
  let toggleSidebar: ReturnType<typeof vi.fn>;
  let openWithContext: ReturnType<typeof vi.fn>;
  let userJotOpen: ReturnType<typeof signal<boolean>>;

  const toggleSidebarCommand: Command = {
    id: 'action-toggle-sidebar',
    label: 'Toggle sidebar',
    description: 'Toggle sidebar',
    action: vi.fn(),
    category: 'Actions',
    shortcut: { keys: ['['] },
    requireAuth: true,
    requireOrganization: true,
    showInCommandMenu: false,
    showInShortcutsSheet: true,
  };

  const switchWorkspaceCommand: Command = {
    id: 'action-switch-workspace',
    label: 'Switch workspace',
    description: 'Switch to a different workspace',
    action: vi.fn(),
    category: 'Actions',
    shortcut: { keys: ['O', 'W'], sequence: 'o+w' },
    requireAuth: true,
    showInCommandMenu: true,
    showInShortcutsSheet: true,
  };

  beforeEach(() => {
    toggleSidebar = vi.fn();
    openWithContext = vi.fn();
    userJotOpen = signal(false);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        KeyboardShortcutService,
        {
          provide: CommandRegistryService,
          useValue: {
            getAllCommands: vi.fn(() => [toggleSidebarCommand, switchWorkspaceCommand]),
          },
        },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated: signal(true).asReadonly(),
          },
        },
        {
          provide: WorkspaceService,
          useValue: {
            workspaceId: signal('workspace-id').asReadonly(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {},
        },
        {
          provide: HlmSidebarService,
          useValue: {
            toggleSidebar,
          },
        },
        {
          provide: AiChatService,
          useValue: {
            shouldCaptureShortcuts: vi.fn(() => false),
          },
        },
        {
          provide: UserJotService,
          useValue: {
            isOpen: userJotOpen.asReadonly(),
          },
        },
        {
          provide: BudgetCategorySelectionService,
          useValue: {
            selectAllVisibleCategories: vi.fn(),
            hasSelections: vi.fn(() => false),
            deselectAllCategories: vi.fn(),
          },
        },
        {
          provide: TransactionSelectionService,
          useValue: {
            getVisibleTransactionIds: vi.fn(() => []),
            selectAllTransactions: vi.fn(),
            hasSelections: vi.fn(() => false),
            deselectAll: vi.fn(),
          },
        },
        {
          provide: CommandMenuService,
          useValue: {
            open: vi.fn(),
            openWithContext,
            isOpen: vi.fn(() => false),
            canGoBack: vi.fn(() => false),
            goBack: vi.fn(),
            close: vi.fn(),
          },
        },
        {
          provide: UndoRedoService,
          useValue: {
            undo: vi.fn(),
            redo: vi.fn(),
          },
        },
        {
          provide: Router,
          useValue: {
            url: '/workspace/budget',
            navigate: vi.fn(),
          },
        },
        {
          provide: Location,
          useValue: {
            back: vi.fn(),
          },
        },
      ],
    });

    service = TestBed.inject(KeyboardShortcutService);
  });

  it('uses [ to toggle the app sidebar', async () => {
    const shortcut = service.getShortcutsByCategory('Actions').find((item) => item.id === '[');

    expect(shortcut).toBeDefined();
    await shortcut?.handler();

    expect(toggleSidebar).toHaveBeenCalledOnce();
  });

  it('does not run shortcut sequences while the UserJot widget is open', () => {
    userJotOpen.set(true);

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));

    expect(openWithContext).not.toHaveBeenCalled();
  });

  it('clears a partial shortcut sequence when the UserJot widget opens', () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', bubbles: true }));
    userJotOpen.set(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    userJotOpen.set(false);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));

    expect(openWithContext).not.toHaveBeenCalled();
  });
});
