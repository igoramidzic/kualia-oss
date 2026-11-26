import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { HlmBadge } from '@spartan-ng/helm/badge';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  KualiaIcon,
  kualiaExpand as Maximize2,
  kualiaCollapse as Minimize2,
  kualiaMinus as Minus,
  kualiaDots as MoreHorizontal,
  kualiaTrash as Trash2,
  kualiaClose as X,
} from '@kualia/icons';
import { HlmDropdownMenuImports } from '../../ui/dropdown-menu/src';
import { HlmTooltip } from '../../ui/tooltip/src';

@Component({
  selector: 'app-ai-chat-panel-header',
  imports: [HlmBadge, HlmButton, KualiaIcon, HlmTooltip, HlmDropdownMenuImports],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ai-chat-panel-header.html',
})
export class AiChatPanelHeaderComponent {
  protected readonly Minus = Minus;
  protected readonly X = X;
  protected readonly MoreHorizontal = MoreHorizontal;
  protected readonly Trash2 = Trash2;
  protected readonly Maximize2 = Maximize2;
  protected readonly Minimize2 = Minimize2;

  readonly title = input<string | null>(null);
  readonly titleSwapping = input<boolean>(false);
  readonly hasActiveThread = input<boolean>(false);
  readonly deleteShortcutLabel = input<string>('');
  readonly expanded = input<boolean>(false);

  readonly minimizeChat = output<void>();
  readonly closeChat = output<void>();
  readonly deleteChat = output<void>();
  readonly toggleExpand = output<void>();
}
