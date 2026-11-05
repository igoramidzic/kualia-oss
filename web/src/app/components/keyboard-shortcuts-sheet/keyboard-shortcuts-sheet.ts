import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BrnSheetContent } from '@spartan-ng/brain/sheet';
import { HlmSheet, HlmSheetContent, HlmSheetDescription, HlmSheetHeader, HlmSheetTitle } from '@spartan-ng/helm/sheet';
import { CommandRegistryService } from '../../services/command-registry.service';
import { KeyboardShortcutService } from '../../services/keyboard-shortcut.service';

@Component({
  selector: 'app-keyboard-shortcuts-sheet',
  imports: [HlmSheet, HlmSheetContent, HlmSheetHeader, HlmSheetTitle, HlmSheetDescription, BrnSheetContent],
  templateUrl: './keyboard-shortcuts-sheet.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyboardShortcutsSheetComponent {
  private readonly keyboardShortcutService = inject(KeyboardShortcutService);
  private readonly commandRegistry = inject(CommandRegistryService);

  readonly sheetState = this.keyboardShortcutService.sheetState;
  readonly isMac = this.keyboardShortcutService.isMac;

  readonly navigationShortcuts = this.commandRegistry
    .getCommandsForShortcutsSheet('Navigation')
    .filter((cmd) => {
      if (!cmd.shortcut?.platformSpecific) return true;
      const isMacShortcut = cmd.shortcut.keys.some((key) => key === '⌘');
      return this.isMac ? isMacShortcut : !isMacShortcut;
    })
    .map((cmd) => ({
      id: cmd.id,
      description: cmd.description ?? cmd.label,
      keys: cmd.shortcut?.keys ?? [],
    }));

  readonly actionShortcuts = this.commandRegistry
    .getCommandsForShortcutsSheet('Actions')
    .filter((cmd) => {
      if (!cmd.shortcut?.platformSpecific) return true;
      const isMacShortcut = cmd.shortcut.keys.some((key) => key === '⌘');
      return this.isMac ? isMacShortcut : !isMacShortcut;
    })
    .map((cmd) => ({
      id: cmd.id,
      description: cmd.description ?? cmd.label,
      keys: cmd.shortcut?.keys ?? [],
    }));

  onStateChanged(state: 'open' | 'closed'): void {
    this.keyboardShortcutService.setSheetOpen(state === 'open');
  }
}
