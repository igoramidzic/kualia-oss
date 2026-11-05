import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { Id } from 'convex/_generated/dataModel';
import { NucleoIcon, nucleoPencil as Pencil, nucleoTrash as Trash2 } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { CategoryService } from '../../services/category.service';

@Component({
  selector: 'app-category-group-name-editor',
  imports: [
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    FormsModule,
    HlmButton,
    HlmInput,
    HlmPopoverContent,
    NucleoIcon,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block',
  },
  template: `
    <brn-popover [state]="popoverState()" (stateChanged)="onPopoverStateChange($event)" align="center" sideOffset="5">
      <button
        hlmBtn
        variant="ghost"
        size="sm"
        type="button"
        [class]="
          popoverState() === 'open'
            ? 'bg-accent w-7 shrink-0 opacity-100 transition-none'
            : 'w-7 shrink-0 opacity-0 transition-none group-hover:opacity-100 focus-visible:opacity-100'
        "
        brnPopoverTrigger
        aria-label="Edit group name"
      >
        <nucleo-icon [icon]="Pencil" [size]="14" class="text-muted-foreground" />
      </button>
      <div *brnPopoverContent="let ctx" class="w-[280px] p-4" hlmPopoverContent>
        <div class="space-y-4">
          <div>
            <label for="group-name-input" class="text-muted-foreground mb-2 block text-sm font-medium"
              >Group Name</label
            >
            <input
              #nameInput
              id="group-name-input"
              hlmInput
              type="text"
              autocomplete="off"
              [ngModel]="editedName()"
              (ngModelChange)="editedName.set($event)"
              (keydown.enter)="onEnterKey()"
              (keydown.escape)="onEscapeKey()"
              class="w-full"
              placeholder="Enter group name"
            />
          </div>
          <div class="flex items-center gap-1">
            @if (groupType() !== 'credit_card') {
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                class="text-destructive hover:text-destructive hover:bg-destructive/10 px-1"
                (click)="onDeleteClick()"
              >
                <nucleo-icon [icon]="Trash2" [size]="14" />
                Delete
              </button>
            }
            <div class="flex-1"></div>
            <button hlmBtn variant="outline" size="sm" type="button" (click)="onEscapeKey()">Cancel</button>
            <button hlmBtn variant="default" size="sm" type="button" (click)="onSave()" [disabled]="saving()">
              Save
            </button>
          </div>
        </div>
      </div>
    </brn-popover>
  `,
})
export class CategoryGroupNameEditorComponent {
  private readonly categoryService = inject(CategoryService);

  // Inputs
  readonly categoryGroupId = input.required<Id<'categoryGroup'>>();
  readonly groupName = input.required<string>();
  readonly groupType = input.required<'expense' | 'credit_card'>();
  readonly isSelected = input<boolean>(false);

  // Outputs
  readonly deleteRequested = output<Id<'categoryGroup'>>();

  // Internal state
  readonly popoverState = signal<'open' | 'closed'>('closed');
  readonly editedName = signal<string>('');
  readonly saving = signal<boolean>(false);

  readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly Pencil = Pencil;
  readonly Trash2 = Trash2;

  constructor() {
    // Reset edited name when popover opens
    effect(() => {
      const state = this.popoverState();
      if (state === 'open') {
        this.editedName.set(this.groupName());
        // Focus input after a short delay to ensure popover is rendered
        setTimeout(() => {
          this.nameInput()?.nativeElement.focus();
          this.nameInput()?.nativeElement.select();
        }, 100);
      }
    });
  }

  onPopoverStateChange(state: 'open' | 'closed'): void {
    this.popoverState.set(state);
  }

  onEnterKey(): void {
    void this.onSave();
  }

  async onSave(): Promise<void> {
    const trimmedName = this.editedName().trim();
    const originalName = this.groupName().trim();

    // Check if there are any changes
    const nameChanged = trimmedName !== originalName;

    // If no changes, just close the popover (no backend call)
    if (!nameChanged) {
      this.popoverState.set('closed');
      return;
    }

    // Validate name is not empty
    if (!trimmedName) {
      return;
    }

    this.saving.set(true);

    try {
      const updates: { name: string } = {
        name: trimmedName,
      };

      const success = await this.categoryService.updateCategoryGroup(this.categoryGroupId(), updates);

      if (success) {
        this.popoverState.set('closed');
      } else {
        const errorMessage = this.categoryService.error() ?? 'Failed to update category group';
        toast.error(errorMessage);
      }
    } catch (error: unknown) {
      console.error('Error updating category group:', error);
      const errorMessage =
        error instanceof Error ? error.message : (this.categoryService.error() ?? 'Failed to update category group');
      toast.error(errorMessage);
    } finally {
      this.saving.set(false);
    }
  }

  onEscapeKey(): void {
    this.editedName.set(this.groupName());
    this.popoverState.set('closed');
  }

  onDeleteClick(): void {
    this.popoverState.set('closed');
    this.deleteRequested.emit(this.categoryGroupId());
  }
}
