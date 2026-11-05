import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { Id } from 'convex/_generated/dataModel';
import { nucleoEye as Eye, nucleoEyeOff as EyeOff, NucleoIcon, nucleoPencil as Pencil } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { CategoryService } from '../../services/category.service';

@Component({
  selector: 'app-category-name-editor',
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
        aria-label="Edit category name"
      >
        <nucleo-icon [icon]="Pencil" [size]="14" class="text-muted-foreground" />
      </button>
      <div *brnPopoverContent="let ctx" class="w-[280px] p-4" hlmPopoverContent>
        <div class="space-y-4">
          <div>
            <label for="category-name-input" class="text-muted-foreground mb-2 block text-sm font-medium"
              >Category Name</label
            >
            <input
              #nameInput
              id="category-name-input"
              hlmInput
              type="text"
              autocomplete="off"
              [ngModel]="editedName()"
              (ngModelChange)="editedName.set($event)"
              (keydown.enter)="onEnterKey()"
              (keydown.escape)="onEscapeKey()"
              class="w-full"
              placeholder="Enter category name"
            />
          </div>
          <div class="flex justify-between gap-2">
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              (click)="onArchive()"
              [disabled]="archiving() || saving()"
            >
              @if (isArchived()) {
                <nucleo-icon [icon]="Eye" [size]="14" class="mr-1" />
                Unhide
              } @else {
                <nucleo-icon [icon]="EyeOff" [size]="14" class="mr-1" />
                Hide
              }
            </button>
            <div class="flex gap-2">
              <button hlmBtn variant="outline" size="sm" type="button" (click)="onEscapeKey()">Cancel</button>
              <button hlmBtn variant="default" size="sm" type="button" (click)="onSave()" [disabled]="saving()">
                Save
              </button>
            </div>
          </div>
        </div>
      </div>
    </brn-popover>
  `,
})
export class CategoryNameEditorComponent {
  private readonly categoryService = inject(CategoryService);

  // Inputs
  readonly categoryId = input.required<Id<'category'>>();
  readonly categoryName = input.required<string>();
  readonly isArchived = input<boolean>(false);

  // Internal state
  readonly popoverState = signal<'open' | 'closed'>('closed');
  readonly editedName = signal<string>('');
  readonly saving = signal<boolean>(false);
  readonly archiving = signal<boolean>(false);

  readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly Pencil = Pencil;
  readonly Eye = Eye;
  readonly EyeOff = EyeOff;

  constructor() {
    // Reset edited name when popover opens
    effect(() => {
      const state = this.popoverState();
      if (state === 'open') {
        this.editedName.set(this.categoryName());
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
    const originalName = this.categoryName().trim();

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

      const success = await this.categoryService.updateCategory(this.categoryId(), updates);

      if (success) {
        this.popoverState.set('closed');
      } else {
        const errorMessage = this.categoryService.error() ?? 'Failed to update category';
        toast.error(errorMessage);
      }
    } catch (error) {
      console.error('Error updating category:', error);
      const errorMessage =
        error instanceof Error ? error.message : (this.categoryService.error() ?? 'Failed to update category');
      toast.error(errorMessage);
    } finally {
      this.saving.set(false);
    }
  }

  onEscapeKey(): void {
    this.editedName.set(this.categoryName());
    this.popoverState.set('closed');
  }

  async onArchive(): Promise<void> {
    this.archiving.set(true);

    try {
      const newArchivedState = !this.isArchived();
      const action = newArchivedState ? 'hiding' : 'unhiding';
      const actionPast = newArchivedState ? 'hidden' : 'unhidden';

      const archivePromise = this.categoryService.archiveCategory(this.categoryId(), newArchivedState);

      toast.promise(archivePromise, {
        loading: `${action.charAt(0).toUpperCase() + action.slice(1)} category...`,
        success: `Category ${actionPast}`,
        error: `Failed to ${action} category`,
      });

      const success = await archivePromise;

      if (success) {
        this.popoverState.set('closed');
      }
    } catch (error) {
      console.error('Error archiving category:', error);
    } finally {
      this.archiving.set(false);
    }
  }
}
