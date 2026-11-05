import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  nucleoWorkspace,
  nucleoCheck,
  nucleoLogout,
  nucleoAssistant,
  nucleoArrowRight,
  nucleoPlus,
  nucleoShop,
} from '@kualia/icons';
import { BrnCommand, BrnCommandImports } from '@spartan-ng/brain/command';
import { BrnDialogImports } from '@spartan-ng/brain/dialog';
import { HlmCommandImports } from '@spartan-ng/helm/command';
import { HlmIcon } from '@spartan-ng/helm/icon';
import { CommandMenuService, WorkspaceItem } from '../../../services/command-menu.service';
import { Command } from '../../models/command.model';

@Component({
  selector: 'app-command-menu',
  templateUrl: './command-menu.component.html',
  imports: [...BrnDialogImports, ...BrnCommandImports, ...HlmCommandImports, NgIcon, HlmIcon],
  providers: [
    provideIcons({
      nucleoCheck,
      nucleoArrowRight,
      nucleoShop,
      nucleoPlus,
      nucleoWorkspace,
      nucleoLogout,
      nucleoAssistant,
    }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandMenuComponent {
  protected readonly commandMenu = inject(CommandMenuService);

  protected readonly commandGroups = this.commandMenu.commandGroups;
  protected readonly context = this.commandMenu.context;
  protected readonly workspaceItems = this.commandMenu.workspaceItems;

  protected readonly searchValue = signal('');

  private readonly brnCommand = viewChild('commandRoot', { read: BrnCommand });

  protected executeCommand(command: Command) {
    if (command.id === 'action-switch-workspace') {
      this.commandMenu.switchContext('workspace-selector');
      this.searchValue.set('');
      return;
    }

    void command.action();
    this.commandMenu.close();
  }

  protected onSearchChange(value: string) {
    this.searchValue.set(value);
  }

  protected onKeyDown(event: KeyboardEvent) {
    // Only handle number keys in workspace-selector context
    if (this.context() !== 'workspace-selector') {
      return;
    }

    const key = event.key;
    const num = parseInt(key, 10);

    // Check if it's a valid number key (1-9)
    if (!isNaN(num) && num >= 1 && num <= 9) {
      event.preventDefault();
      event.stopPropagation();

      // Find workspace with this number
      const workspaces = this.workspaceItems();
      const workspaceIndex = workspaces.findIndex((ws) => ws.number === num);
      const workspace = workspaces[workspaceIndex];

      if (workspace) {
        // Highlight the item using the key manager
        const command = this.brnCommand();
        if (command) {
          command.keyManager.setActiveItem(workspaceIndex);
        }

        void this.commandMenu.selectWorkspace(workspace);
      }
    }
  }

  protected executeWorkspaceSelection(workspace: WorkspaceItem) {
    void this.commandMenu.selectWorkspace(workspace);
  }
}
