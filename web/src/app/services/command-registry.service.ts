import { inject, Injectable } from '@angular/core';
import { Command, CommandGroup } from '../shared/models/command.model';
import { AiChatService } from './ai-chat.service';
import { AuthService } from './auth.service';
import { MerchantService } from './merchant.service';
import { NavigationService } from './navigation.service';
import { TransactionService } from './transaction.service';

@Injectable({
  providedIn: 'root',
})
export class CommandRegistryService {
  private readonly navigation = inject(NavigationService);
  private readonly auth = inject(AuthService);
  private readonly merchantService = inject(MerchantService);
  private readonly transactionService = inject(TransactionService);
  private readonly aiChatService = inject(AiChatService);

  /** Toggle the new-chat panel — opens it if closed, minimizes when already on the new-chat slot. */
  private toggleNewChat(): void {
    if (this.aiChatService.pendingNewChat()) {
      this.aiChatService.minimize();
    } else {
      this.aiChatService.openNewChat();
    }
  }

  private readonly commands: Command[] = [
    {
      id: 'action-escape',
      label: 'Go back',
      description: 'Go back',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['Escape'] },
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-open-command-menu-mac',
      label: 'Open command menu',
      description: 'Open command menu',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['⌘', 'K'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-open-command-menu-windows',
      label: 'Open command menu',
      description: 'Open command menu',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['Ctrl', 'K'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-toggle-shortcuts-mac',
      label: 'Toggle keyboard shortcuts',
      description: 'Toggle keyboard shortcuts',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['⌘', '/'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-toggle-shortcuts-windows',
      label: 'Toggle keyboard shortcuts',
      description: 'Toggle keyboard shortcuts',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['Ctrl', '/'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-toggle-sidebar',
      label: 'Toggle sidebar',
      description: 'Toggle sidebar',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['['] },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-budget',
      label: 'Go to Budget',
      description: 'Go to Budget',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToBudget(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'B'], sequence: 'g+b' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-transactions',
      label: 'Go to Transactions',
      description: 'Go to Transactions',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToTransactions(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'T'], sequence: 'g+t' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    // {
    //   id: 'nav-projects',
    //   label: 'Go to Projects',
    //   description: 'Go to Projects',
    //   icon: MoveRight,
    //   action: () => this.navigation.navigateToProjects(),
    //   category: 'Navigation',
    //   requireAuth: true,
    //   requireOrganization: true,
    //   showInCommandMenu: true,
    //   showInShortcutsSheet: false,
    // },
    // {
    //   id: 'nav-categories',
    //   label: 'Go to Categories',
    //   description: 'Go to Categories',
    //   icon: MoveRight,
    //   action: () => this.navigation.navigateToCategories(),
    //   category: 'Navigation',
    //   requireAuth: true,
    //   requireOrganization: true,
    //   showInCommandMenu: true,
    //   showInShortcutsSheet: false,
    // },
    {
      id: 'nav-bank-accounts',
      label: 'Go to Bank Accounts',
      description: 'Go to Bank Accounts',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToBankAccounts(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'A'], sequence: 'g+a' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-planned',
      label: 'Go to Planned',
      description: 'Go to Planned',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToPlanned(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'C'], sequence: 'g+c' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-reports',
      label: 'Go to Reports',
      description: 'Go to Reports',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToReports(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'R'], sequence: 'g+r' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-settings',
      label: 'Go to Settings',
      description: 'Go to Settings',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToSettings(),
      category: 'Navigation',
      shortcut: { keys: ['G', 'S'], sequence: 'g+s' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'nav-settings-bank-connections',
      label: 'Go to Bank Connections',
      description: 'Go to Bank Connections',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToSettingsConnectedAccounts(),
      category: 'Navigation',
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: false,
    },
    {
      id: 'nav-settings-preferences',
      label: 'Go to Preferences',
      description: 'Go to Preferences',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToWorkspace(['settings', 'preferences']),
      category: 'Navigation',
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: false,
    },
    {
      id: 'nav-merchants',
      label: 'Go to Merchants',
      description: 'Go to Merchants',
      icon: 'nucleoArrowRight',
      action: () => this.navigation.navigateToMerchants(),
      category: 'Navigation',
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: false,
    },
    {
      id: 'action-create-merchant',
      label: 'Create new merchant...',
      description: 'Create a new merchant',
      icon: 'nucleoShop',
      action: () => {
        this.merchantService.openCreateDialog();
      },
      category: 'Actions',
      shortcut: { keys: ['N', 'M'], sequence: 'n+m' },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-create-transaction',
      label: 'Create new transaction...',
      description: 'Create a new transaction',
      icon: 'nucleoPlus',
      action: () => {
        this.transactionService.openCreateDialog();
      },
      category: 'Actions',
      shortcut: { keys: ['C'] },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-switch-workspace',
      label: 'Switch workspace',
      description: 'Switch to a different workspace',
      icon: 'nucleoWorkspace',
      action: () => {
        // Handled by command menu component and keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['O', 'W'], sequence: 'o+w' },
      requireAuth: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-undo-mac',
      label: 'Undo',
      description: 'Undo last action',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['⌘', 'Z'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-undo-windows',
      label: 'Undo',
      description: 'Undo last action',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['Ctrl', 'Z'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-redo-mac',
      label: 'Redo',
      description: 'Redo last undone action',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['⌘', 'Shift', 'Z'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-redo-windows',
      label: 'Redo',
      description: 'Redo last undone action',
      action: () => {
        // Handled by keyboard shortcut service
      },
      category: 'Actions',
      shortcut: { keys: ['Ctrl', 'Shift', 'Z'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: false,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-toggle-new-chat-mac',
      label: 'Open Kualia chat',
      description: 'Open Kualia chat',
      icon: 'nucleoAssistant',
      action: () => this.toggleNewChat(),
      category: 'Actions',
      shortcut: { keys: ['⌘', 'J'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-toggle-new-chat-windows',
      label: 'Open Kualia chat',
      description: 'Open Kualia chat',
      icon: 'nucleoAssistant',
      action: () => this.toggleNewChat(),
      category: 'Actions',
      shortcut: { keys: ['Ctrl', 'J'], platformSpecific: true },
      requireAuth: true,
      requireOrganization: true,
      showInCommandMenu: true,
      showInShortcutsSheet: true,
    },
    {
      id: 'action-logout',
      label: 'Log out',
      description: 'Log out',
      icon: 'nucleoLogout',
      action: async () => {
        await this.auth.logout();
      },
      category: 'Actions',
      shortcut: { keys: ['Ctrl', 'Shift', 'Q'] },
      requireAuth: true,
      showInCommandMenu: true,
      showInShortcutsSheet: false,
    },
  ];

  getCommand(id: string): Command | undefined {
    return this.commands.find((cmd) => cmd.id === id);
  }

  getAllCommands(): Command[] {
    return [...this.commands];
  }

  getCommandsByCategory(category: 'Navigation' | 'Actions'): Command[] {
    return this.commands.filter((cmd) => cmd.category === category);
  }

  getCommandsForMenu(): CommandGroup[] {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac');
    const grouped = this.commands.reduce(
      (acc, cmd) => {
        if (cmd.showInCommandMenu === false) return acc;
        // Drop the off-platform variant of platform-specific shortcuts so the menu only lists
        // one entry with the user's actual key combo.
        if (cmd.shortcut?.platformSpecific) {
          const isMacShortcut = cmd.shortcut.keys.some((key) => key === '⌘');
          if (isMac !== isMacShortcut) return acc;
        }
        if (!acc[cmd.category]) {
          acc[cmd.category] = [];
        }
        acc[cmd.category].push(cmd);
        return acc;
      },
      {} as Record<string, Command[]>
    );

    return Object.entries(grouped).map(([label, commands]) => ({
      label,
      commands,
    }));
  }

  getCommandsForShortcutsSheet(category: 'Navigation' | 'Actions'): Command[] {
    return this.commands.filter((cmd) => cmd.category === category && cmd.showInShortcutsSheet !== false);
  }

  getCommandsWithShortcuts(): Command[] {
    return this.commands.filter((cmd) => cmd.shortcut);
  }
}
