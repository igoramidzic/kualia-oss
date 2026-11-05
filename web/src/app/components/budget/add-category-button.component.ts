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
import { NucleoIcon, nucleoPlus as Plus } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { CategoryService } from '../../services/category.service';

@Component({
  selector: 'app-add-category-button',
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
        aria-label="Add category"
      >
        <nucleo-icon [icon]="Plus" [size]="14" class="text-muted-foreground" />
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
              [ngModel]="categoryName()"
              (ngModelChange)="categoryName.set($event)"
              (keydown.enter)="onEnterKey()"
              (keydown.escape)="onEscapeKey()"
              class="w-full"
              placeholder="Enter category name"
            />
          </div>
          <div class="flex justify-end gap-2">
            <button hlmBtn variant="outline" size="sm" type="button" (click)="onEscapeKey()">Cancel</button>
            <button hlmBtn variant="default" size="sm" type="button" (click)="onSave()" [disabled]="saving()">
              Add
            </button>
          </div>
        </div>
      </div>
    </brn-popover>
  `,
})
export class AddCategoryButtonComponent {
  private readonly categoryService = inject(CategoryService);

  // Inputs
  readonly categoryGroupId = input.required<Id<'categoryGroup'>>();

  // Internal state
  readonly popoverState = signal<'open' | 'closed'>('closed');
  readonly categoryName = signal<string>('');
  readonly saving = signal<boolean>(false);

  readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly Plus = Plus;

  constructor() {
    // Reset name when popover opens
    effect(() => {
      const state = this.popoverState();
      if (state === 'open') {
        this.categoryName.set('');
        // Focus input after a short delay to ensure popover is rendered
        setTimeout(() => {
          this.nameInput()?.nativeElement.focus();
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
    const trimmedName = this.categoryName().trim();

    // Validate name is not empty
    if (!trimmedName) {
      return;
    }

    this.saving.set(true);

    try {
      const result = await this.categoryService.createCategory(trimmedName, this.categoryGroupId());

      if (result) {
        this.popoverState.set('closed');
      } else {
        const errorMessage = this.categoryService.error() ?? 'Failed to create category';
        toast.error(errorMessage);
      }
    } catch (error: unknown) {
      console.error('Error creating category:', error);
      const errorMessage =
        error instanceof Error ? error.message : (this.categoryService.error() ?? 'Failed to create category');
      toast.error(errorMessage);
    } finally {
      this.saving.set(false);
    }
  }

  onEscapeKey(): void {
    this.categoryName.set('');
    this.popoverState.set('closed');
  }
}
