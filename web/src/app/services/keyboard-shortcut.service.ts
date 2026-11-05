import { Location } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { HlmSidebarService } from '@spartan-ng/helm/sidebar';
import { UserPreferencesService } from '../core/services/preferences/user-preferences.service';
import type { Command } from '../shared/models/command.model';
import { AiChatService } from './ai-chat.service';
import { AuthService } from './auth.service';
import { BudgetCategorySelectionService } from './budget-category-selection.service';
import { CommandMenuService } from './command-menu.service';
import { CommandRegistryService } from './command-registry.service';
import { TransactionSelectionService } from './transaction-selection.service';
import { UndoRedoService } from './undo-redo.service';
import { WorkspaceService } from './workspace.service';

interface ShortcutHandler {
  handler: () => void | Promise<void>;
  description: string;
  category: 'Navigation' | 'Actions';
  keys: string[];
  platformSpecific?: boolean;
  requireAuth?: boolean;
  requireOrganization?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class KeyboardShortcutService {
  private readonly commandRegistry = inject(CommandRegistryService);
  private readonly authService = inject(AuthService);
  private readonly budgetSelectionService = inject(BudgetCategorySelectionService);
  private readonly transactionSelectionService = inject(TransactionSelectionService);
  private readonly commandMenuService = inject(CommandMenuService);
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly userPreferencesService = inject(UserPreferencesService);
  private readonly workspaceService = inject(WorkspaceService);
  private readonly undoRedoService = inject(UndoRedoService);
  private readonly aiChatService = inject(AiChatService);
  private readonly appSidebarService = inject(HlmSidebarService);

  private readonly _sheetOpen = signal(false);
  readonly sheetOpen = this._sheetOpen.asReadonly();
  readonly sheetState = computed<'open' | 'closed'>(() => (this._sheetOpen() ? 'open' : 'closed'));

  private sequenceState = signal<string | null>(null);
  private sequenceTimeout: ReturnType<typeof setTimeout> | null = null;

  private shortcuts = new Map<string, ShortcutHandler>();

  readonly isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');

  constructor() {
    this.registerShortcuts();
    this.setupGlobalListener();
  }

  private registerShortcuts(): void {
    const specialHandlers: Record<string, () => void | Promise<void>> = {
      'action-escape': () => this.handleEscapeKey(),
      'action-open-command-menu-mac': () => this.commandMenuService.open(),
      'action-open-command-menu-windows': () => this.commandMenuService.open(),
      'action-toggle-shortcuts-mac': () => this.toggleSidebar(),
      'action-toggle-shortcuts-windows': () => this.toggleSidebar(),
      'action-toggle-sidebar': () => this.appSidebarService.toggleSidebar(),
      'action-switch-workspace': () => this.commandMenuService.openWithContext('workspace-selector'),
      'action-undo-mac': () => void this.undoRedoService.undo(),
      'action-undo-windows': () => void this.undoRedoService.undo(),
      'action-redo-mac': () => void this.undoRedoService.redo(),
      'action-redo-windows': () => void this.undoRedoService.redo(),
    };

    const allCommands = this.commandRegistry.getAllCommands();

    for (const command of allCommands) {
      if (!command.shortcut) continue;

      const keyString = this.getKeyStringFromCommand(command);
      if (!keyString) continue;

      const handler = specialHandlers[command.id] ?? command.action;

      this.shortcuts.set(keyString, {
        handler: async () => {
          await handler();
          if (command.category === 'Navigation') {
            this.closeSidebar();
          }
        },
        description: command.description ?? command.label,
        category: command.category,
        keys: command.shortcut.keys,
        requireAuth: command.requireAuth,
        requireOrganization: command.requireOrganization,
        platformSpecific: command.shortcut.platformSpecific,
      });
    }
  }

  private getKeyStringFromCommand(command: Command): string | null {
    const shortcut = command.shortcut;
    if (!shortcut) return null;

    if (shortcut.sequence) {
      return shortcut.sequence;
    }

    const keys = shortcut.keys;
    if (keys.length === 0) return null;

    // Handle Mac shortcuts with ⌘
    if (keys.includes('⌘')) {
      return keys
        .map((k: string) => (k === '⌘' ? 'Meta' : k.toLowerCase()))
        .join('+')
        .toLowerCase();
    }

    // Handle Windows/Linux shortcuts with Ctrl
    if (keys.includes('Ctrl')) {
      return keys
        .map((k: string) => (k === 'Ctrl' ? 'Control' : k.toLowerCase()))
        .join('+')
        .toLowerCase();
    }

    // Single key shortcuts
    if (keys.length === 1) {
      const firstKey = keys[0];
      return firstKey?.toLowerCase() ?? null;
    }

    return null;
  }

  private setupGlobalListener(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (event: KeyboardEvent) => {
      const key = this.getKeyString(event);
      const currentSequence = this.sequenceState();

      // Try to find the shortcut first to check its requirements
      let shortcut: ShortcutHandler | undefined;
      if (currentSequence) {
        const sequenceKey = `${currentSequence}+${key.toLowerCase()}`;
        shortcut = this.shortcuts.get(sequenceKey);
      } else {
        shortcut = this.shortcuts.get(key);
      }

      // Check if we should ignore this event (including shortcut requirements)
      const shouldIgnore = this.shouldIgnoreEvent(event, shortcut);

      if (shouldIgnore) {
        return;
      }

      // Handle Command-A (Mac) or Ctrl-A (Windows) for select all
      if ((event.key === 'a' || event.key === 'A') && (event.metaKey || event.ctrlKey)) {
        if (this.router.url.includes('/budget')) {
          event.preventDefault();
          this.budgetSelectionService.selectAllVisibleCategories();
          return;
        }

        if (this.router.url.includes('/transactions') || this.router.url.includes('/bank-accounts/')) {
          event.preventDefault();
          const visibleIds = this.transactionSelectionService.getVisibleTransactionIds();
          this.transactionSelectionService.selectAllTransactions(visibleIds);
          return;
        }
      }

      // Handle sequence continuation
      if (currentSequence) {
        if (shortcut) {
          event.preventDefault();
          this.clearSequence();
          void shortcut.handler();
          return;
        }

        this.clearSequence();
        return;
      }

      // Start sequence for 'g' key
      if (key.toLowerCase() === 'g') {
        event.preventDefault();
        this.startSequence('g');
        return;
      }

      // Start sequence for 'n' key
      if (key.toLowerCase() === 'n') {
        event.preventDefault();
        this.startSequence('n');
        return;
      }

      // Start sequence for 'o' key
      if (key.toLowerCase() === 'o') {
        event.preventDefault();
        this.startSequence('o');
        return;
      }

      // Execute shortcut
      if (shortcut) {
        event.preventDefault();
        void shortcut.handler();
      }
    });
  }

  private shouldIgnoreEvent(event: KeyboardEvent, shortcut?: ShortcutHandler): boolean {
    const target = event.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const currentUrl = this.router.url;

    // When the expanded chat owns the keyboard, suppress page-content shortcuts (sequences,
    // Cmd+A select-all, undo/redo, navigation, etc.) so they don't fire from under the panel.
    // Keep Escape, the command menu (Cmd+K, Cmd+/), and the chat toggle (Cmd+J) — those are
    // global affordances that must always work, including from inside the chat itself.
    if (event.key !== 'Escape' && this.aiChatService.shouldCaptureShortcuts()) {
      const isGlobalAffordance =
        (event.metaKey || event.ctrlKey) &&
        (event.key === 'k' || event.key === 'K' || event.key === '/' || event.key === 'j' || event.key === 'J');
      if (!isGlobalAffordance) {
        return true;
      }
    }

    // Block all shortcuts on specific routes (except escape which is handled separately)
    const blockedRoutes = ['/login', '/join', '/auth/callback'];
    if (event.key !== 'Escape' && blockedRoutes.some((route) => currentUrl.startsWith(route))) {
      return true;
    }

    // Block shortcuts on onboarding page (URL pattern: /:workspaceShortId/onboarding)
    if (event.key !== 'Escape' && currentUrl.includes('/onboarding')) {
      return true;
    }

    // Check shortcut requirements
    if (shortcut) {
      if (shortcut.requireAuth && !this.authService.isAuthenticated()) {
        return true;
      }

      if (shortcut.requireOrganization && !this.workspaceService.workspaceId()) {
        return true;
      }
    }

    // For non-escape keys, ignore when in input/textarea/contenteditable
    if (event.key !== 'Escape') {
      // Allow command menu shortcuts (Cmd+K, Cmd+/) and the Kualia chat toggle (Cmd+J) even in
      // inputs — these are global app affordances and the chat toggle is most useful precisely
      // when the user is typing in another field and wants to ask Kualia about it.
      const isAllowedInInput =
        (event.metaKey || event.ctrlKey) &&
        (event.key === 'k' || event.key === 'K' || event.key === '/' || event.key === 'j' || event.key === 'J');

      if (!isAllowedInInput && (tagName === 'input' || tagName === 'textarea' || target.isContentEditable)) {
        return true;
      }
    }

    // For escape key, check priority hierarchy
    if (event.key === 'Escape') {
      // Priority 1: Modals/Dialogs (highest priority - always close these first).
      // The AI chat panel is a non-modal floater (`aria-modal="false"`) — treat it as blocking
      // ONLY when focus is inside it. Otherwise Escape needs to fall through so page actions like
      // deselecting a transaction still work while the chat sits open in the corner or expanded.
      const focusInChat = !!target.closest('[data-ai-chat-dialog]');
      const hasOpenDialog = !!document.querySelector('[role="dialog"]:not([data-ai-chat-dialog])') || focusInChat;
      const cdkOverlayElement = document.querySelector('.cdk-overlay-container .cdk-overlay-pane');

      // Check for Spartan NG brain dialog elements
      const brnDialogBackdrop = document.querySelector('[data-brn-dialog-overlay]');
      const dialogWithDataState = document.querySelector('[data-brn-dialog-content][data-state="open"]');

      // Check if the CDK overlay is actually visible and active
      let hasCdkOverlay = false;
      if (cdkOverlayElement && cdkOverlayElement instanceof HTMLElement) {
        const style = window.getComputedStyle(cdkOverlayElement);
        const isVisible =
          cdkOverlayElement.offsetParent !== null &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';
        const hasContent = cdkOverlayElement.children.length > 0;

        hasCdkOverlay = isVisible && hasContent;
      }

      if (hasOpenDialog || hasCdkOverlay || brnDialogBackdrop || dialogWithDataState) {
        return true;
      }

      // Priority 2: Dropdowns/Menus/Popovers (close these next)
      const hasOpenMenu = document.querySelector('[role="menu"]');
      const hasOpenListbox = document.querySelector('[role="listbox"]');
      const hasOpenCombobox = document.querySelector('[role="combobox"][aria-expanded="true"]');

      if (hasOpenMenu || hasOpenListbox || hasOpenCombobox) {
        return true;
      }

      // Priority 3: Focused inputs/textareas - blur first, don't navigate yet
      if (tagName === 'input' || tagName === 'textarea' || target.isContentEditable) {
        // Always blur focused inputs on Escape - user likely wants to dismiss the input, not navigate
        event.preventDefault();
        target.blur();
        return true;
      }
    }

    return false;
  }

  private getKeyString(event: KeyboardEvent): string {
    const parts: string[] = [];

    if (event.ctrlKey) parts.push('Control');
    if (event.metaKey) parts.push('Meta');
    if (event.shiftKey && event.key !== 'Shift') parts.push('Shift');
    if (event.altKey) parts.push('Alt');

    const key = event.key === ' ' ? 'Space' : event.key;
    parts.push(key);

    return parts.join('+').toLowerCase();
  }

  private startSequence(key: string): void {
    this.sequenceState.set(key);

    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
    }

    this.sequenceTimeout = setTimeout(() => {
      this.clearSequence();
    }, 2000);
  }

  private clearSequence(): void {
    this.sequenceState.set(null);
    if (this.sequenceTimeout) {
      clearTimeout(this.sequenceTimeout);
      this.sequenceTimeout = null;
    }
  }

  toggleSidebar(): void {
    this._sheetOpen.update((open) => !open);
  }

  closeSidebar(): void {
    this._sheetOpen.set(false);
  }

  setSheetOpen(open: boolean): void {
    this._sheetOpen.set(open);
  }

  private handleEscapeKey(): void {
    // Priority 1: If command menu is open and has context, go back
    if (this.commandMenuService.isOpen() && this.commandMenuService.canGoBack()) {
      this.commandMenuService.goBack();
      return;
    }

    // Priority 2: Close command menu if open
    if (this.commandMenuService.isOpen()) {
      this.commandMenuService.close();
      return;
    }

    const currentUrl = this.router.url;

    // On budget page, deselect categories first (if any are selected)
    if (currentUrl.includes('/budget') && this.budgetSelectionService.hasSelections()) {
      this.budgetSelectionService.deselectAllCategories();
      return;
    }

    // On transactions page, deselect transactions first (if any are selected)
    if (
      (currentUrl.includes('/transactions') || currentUrl.includes('/bank-accounts/')) &&
      this.transactionSelectionService.hasSelections()
    ) {
      this.transactionSelectionService.deselectAll();
      return;
    }

    const urlSegments = currentUrl.split('/').filter((segment) => segment);

    // Need at least 3 segments to navigate back (workspace/section/subsection)
    if (urlSegments.length <= 2) {
      return;
    }

    const workspaceSlug = urlSegments[0];
    const section = urlSegments[1];

    // Handle settings section specially due to its hierarchical structure
    if (section === 'settings') {
      // If we're at a top-level settings page (3 segments: /workspace/settings/X), don't navigate
      if (urlSegments.length === 3) {
        return;
      }

      // If we're deeper than top-level (4+ segments)
      if (urlSegments.length >= 4) {
        const settingsSubsection = urlSegments[2];

        // For other subsections, navigate to the list page
        void this.router.navigate([workspaceSlug, 'settings', settingsSubsection]);
      }
      return;
    }

    const topLevelSections = ['bank-accounts', 'transactions', 'projects'];

    // If we're in a top-level section with a subsection, navigate to the section root
    if (topLevelSections.includes(section)) {
      const currentPath = `/${urlSegments.join('/')}`;
      const sectionRootPath = `/${workspaceSlug}/${section}`;

      // Only navigate if we're not already at the section root
      if (currentPath !== sectionRootPath) {
        void this.router.navigate([workspaceSlug, section]);
      }
    } else {
      this.location.back();
    }
  }

  getShortcutsByCategory(category: 'Navigation' | 'Actions'): (ShortcutHandler & { id: string })[] {
    return Array.from(this.shortcuts.entries())
      .filter(([, handler]) => handler.category === category)
      .filter(([key, handler]) => {
        if (handler.platformSpecific) {
          if (this.isMac && key.includes('Meta')) return true;
          if (!this.isMac && key.includes('Control') && !key.includes('Shift')) return true;
          return false;
        }
        return true;
      })
      .map(([key, handler]) => ({
        id: key,
        ...handler,
      }))
      .filter((item, index, self) => {
        return index === self.findIndex((t) => t.description === item.description);
      });
  }
}
