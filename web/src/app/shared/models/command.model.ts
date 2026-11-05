export interface CommandShortcut {
  keys: string[];
  platformSpecific?: boolean;
  sequence?: string;
}

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  shortcut?: CommandShortcut;
  action: () => void | Promise<void> | Promise<boolean>;
  category: 'Navigation' | 'Actions';
  requireAuth?: boolean;
  requireOrganization?: boolean;
  showInCommandMenu?: boolean;
  showInShortcutsSheet?: boolean;
}

export interface CommandGroup {
  label: string;
  commands: Command[];
}
