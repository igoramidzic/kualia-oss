import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { BrnPopover, BrnPopoverContent, BrnPopoverTrigger } from '@spartan-ng/brain/popover';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmDialogFooter, HlmDialogHeader } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmLabel } from '@spartan-ng/helm/label';
import { HlmPopoverContent } from '@spartan-ng/helm/popover';
import { HlmRadio, HlmRadioGroup, HlmRadioIndicator } from '@spartan-ng/helm/radio-group';
import { api } from 'convex/_generated/api';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoWorkspace as Building2,
  nucleoCheck as Check,
  nucleoChevronDown as ChevronDown,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
} from '@kualia/icons';
import { ConvexService } from '../../../services/convex.service';
import { ReportingService, TrackingEvent } from '../../../services/reporting.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { CurrencySelectorComponent } from '../../currency-selector/currency-selector.component';

type Workspace = {
  _id: string;
  _creationTime: number;
  name: string;
  role: string;
};

interface DialogContext {
  currentCurrency?: string;
  onClose: (workspaceId?: string) => void;
}

type CategoryOption = 'default' | 'copy';

@Component({
  selector: 'app-create-workspace-dialog',
  imports: [
    FormsModule,
    HlmButton,
    HlmDialogHeader,
    HlmDialogFooter,
    HlmInput,
    HlmLabel,
    HlmRadio,
    HlmRadioGroup,
    HlmRadioIndicator,
    NucleoIcon,
    CurrencySelectorComponent,
    BrnPopover,
    BrnPopoverTrigger,
    BrnPopoverContent,
    HlmPopoverContent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-dialog-header>
      <h2 class="text-lg font-semibold">Create Workspace</h2>
      <p class="text-muted-foreground text-sm">Set up a new workspace with your preferences.</p>
    </hlm-dialog-header>

    <div class="space-y-5 p-4">
      <!-- Name Field -->
      <div class="space-y-2">
        <label hlmLabel for="workspace-name" class="text-sm">Workspace Name</label>
        <input
          hlmInput
          id="workspace-name"
          type="text"
          [ngModel]="workspaceName()"
          (ngModelChange)="workspaceName.set($event)"
          maxlength="26"
          placeholder="e.g., Personal Budget"
          class="h-10 w-full"
          [disabled]="creating()"
        />
      </div>

      <!-- Currency Field -->
      <div class="space-y-2">
        <label hlmLabel for="currency-selector" class="text-sm">Currency</label>
        <app-currency-selector
          id="currency-selector"
          [selectedCurrency]="selectedCurrency()"
          [disabled]="creating()"
          (currencyChange)="selectCurrency($event)"
        />
      </div>

      <!-- Category Options -->
      <div class="space-y-3">
        <label hlmLabel for="category-options" class="text-sm">Categories</label>
        <hlm-radio-group
          id="category-options"
          class="flex flex-col gap-2"
          [value]="categoryOption()"
          (valueChange)="selectCategoryOption($event)"
        >
          <div
            class="border-border hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
            [class.border-primary]="categoryOption() === 'default'"
            [class.bg-primary/5]="categoryOption() === 'default'"
            tabindex="0"
            (click)="selectCategoryOption('default')"
            (keydown.enter)="selectCategoryOption('default')"
            (keydown.space)="selectCategoryOption('default'); $event.preventDefault()"
          >
            <hlm-radio value="default">
              <hlm-radio-indicator indicator />
            </hlm-radio>
            <div class="flex-1">
              <span class="text-sm font-medium">Use Default Categories</span>
              <p class="text-muted-foreground text-xs">Start with pre-configured budget categories</p>
            </div>
          </div>

          @if (hasWorkspacesToCopyFrom()) {
            <div
              class="border-border hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
              [class.border-primary]="categoryOption() === 'copy'"
              [class.bg-primary/5]="categoryOption() === 'copy'"
              tabindex="0"
              (click)="selectCategoryOption('copy')"
              (keydown.enter)="selectCategoryOption('copy')"
              (keydown.space)="selectCategoryOption('copy'); $event.preventDefault()"
            >
              <hlm-radio value="copy">
                <hlm-radio-indicator indicator />
              </hlm-radio>
              <div class="flex-1">
                <span class="text-sm font-medium">Copy from Workspace</span>
                <p class="text-muted-foreground text-xs">Copy categories from an existing workspace</p>
              </div>
            </div>
          }
        </hlm-radio-group>

        <!-- Workspace Selector (shown when copy is selected) -->
        @if (categoryOption() === 'copy') {
          <div class="mt-3">
            <brn-popover
              [state]="workspacePopoverState()"
              (stateChanged)="workspacePopoverState.set($event)"
              sideOffset="5"
            >
              <button
                type="button"
                hlmBtn
                variant="outline"
                brnPopoverTrigger
                [disabled]="creating()"
                class="w-full justify-between font-normal"
              >
                @if (selectedSourceWorkspace()) {
                  <span class="flex items-center gap-2">
                    <nucleo-icon [icon]="Building2" [size]="14" />
                    <span>{{ selectedSourceWorkspace()?.name }}</span>
                  </span>
                } @else {
                  <span class="text-muted-foreground">Select workspace to copy from...</span>
                }
                <nucleo-icon [icon]="ChevronDown" [size]="14" class="text-muted-foreground" />
              </button>
              <div *brnPopoverContent="let ctx" hlmPopoverContent class="w-[300px] p-1">
                @if (workspacesLoading()) {
                  <div class="text-muted-foreground p-3 text-center text-sm">Loading workspaces...</div>
                } @else if (workspaces().length === 0) {
                  <div class="text-muted-foreground p-3 text-center text-sm">No workspaces available</div>
                } @else {
                  @for (workspace of workspaces(); track workspace._id) {
                    <button
                      type="button"
                      class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors"
                      (click)="selectSourceWorkspace(workspace)"
                    >
                      <nucleo-icon [icon]="Building2" [size]="14" class="text-muted-foreground" />
                      <span class="flex-1">{{ workspace.name }}</span>
                      @if (selectedSourceWorkspaceId() === workspace._id) {
                        <nucleo-icon [icon]="Check" [size]="14" class="text-primary" />
                      }
                    </button>
                  }
                }
              </div>
            </brn-popover>
          </div>
        }
      </div>

      @if (error()) {
        <div class="bg-destructive/10 text-destructive border-destructive/20 rounded-lg border p-3">
          <p class="text-sm">{{ error() }}</p>
        </div>
      }
    </div>

    <hlm-dialog-footer>
      <button hlmBtn size="sm" variant="outline" (click)="cancel()" [disabled]="creating()">Cancel</button>
      <button hlmBtn size="sm" (click)="create()" [disabled]="!canCreate() || creating()">
        @if (creating()) {
          <nucleo-icon [icon]="LoaderCircle" class="mr-2 h-4 w-4 animate-spin" />
          Creating...
        } @else {
          Create Workspace
        }
      </button>
    </hlm-dialog-footer>
  `,
})
export class CreateWorkspaceDialogComponent {
  protected readonly Building2 = Building2;
  protected readonly ChevronDown = ChevronDown;
  protected readonly Check = Check;
  protected readonly LoaderCircle = LoaderCircle;

  private readonly convexService = inject(ConvexService);
  private readonly reportingService = inject(ReportingService);
  protected readonly dialogContext = injectBrnDialogContext<DialogContext>();

  // Form state
  protected readonly workspaceName = signal('');
  protected readonly selectedCurrency = signal<string>(this.dialogContext.currentCurrency ?? 'USD');
  protected readonly categoryOption = signal<CategoryOption>('default');
  protected readonly selectedSourceWorkspaceId = signal<string | null>(null);

  // UI state
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly workspacePopoverState = signal<'open' | 'closed'>('closed');

  // Workspaces query
  private readonly workspacesQuery = this.convexService.query<Workspace[]>(api.workspaces.getUserWorkspaces, {});
  protected readonly workspaces = computed(() => this.workspacesQuery() ?? []);
  protected readonly workspacesLoading = computed(() => this.workspacesQuery() === undefined);

  protected readonly selectedSourceWorkspace = computed(() => {
    const id = this.selectedSourceWorkspaceId();
    if (!id) return null;
    return this.workspaces().find((w) => w._id === id) ?? null;
  });

  // Only show "Copy from Workspace" option if there are workspaces to copy from
  protected readonly hasWorkspacesToCopyFrom = computed(() => this.workspaces().length > 0);

  protected readonly canCreate = computed(() => {
    const name = this.workspaceName().trim();
    if (!name) return false;
    if (this.categoryOption() === 'copy' && !this.selectedSourceWorkspaceId()) return false;
    return true;
  });

  selectCurrency(currency: string): void {
    this.selectedCurrency.set(currency);
  }

  selectCategoryOption(option: CategoryOption | undefined): void {
    if (option) {
      this.categoryOption.set(option);
    }
  }

  selectSourceWorkspace(workspace: Workspace): void {
    this.selectedSourceWorkspaceId.set(workspace._id);
    this.workspacePopoverState.set('closed');
  }

  cancel(): void {
    this.dialogContext.onClose();
  }

  async create(): Promise<void> {
    if (!this.canCreate() || this.creating()) return;

    this.creating.set(true);
    this.error.set(null);

    try {
      const args: {
        name: string;
        currency: string;
        categoryOption: CategoryOption;
        sourceWorkspaceId?: Id<'workspace'>;
      } = {
        name: this.workspaceName().trim(),
        currency: this.selectedCurrency(),
        categoryOption: this.categoryOption(),
      };

      if (this.categoryOption() === 'copy' && this.selectedSourceWorkspaceId()) {
        args.sourceWorkspaceId = this.selectedSourceWorkspaceId() as Id<'workspace'>;
      }

      const workspaceId = await this.convexService.mutation(api.workspaces.createWorkspaceWithOptions, args);
      this.reportingService.capture(TrackingEvent.WORKSPACE_CREATED);
      this.dialogContext.onClose(workspaceId as string);
    } catch (err: unknown) {
      this.error.set(extractConvexErrorMessage(err, 'Failed to create workspace'));
      this.creating.set(false);
    }
  }
}
