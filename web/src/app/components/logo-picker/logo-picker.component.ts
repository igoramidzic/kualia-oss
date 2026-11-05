import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { BrnComboboxImports } from '@spartan-ng/brain/combobox';
import { HlmComboboxImports } from '@spartan-ng/helm/combobox';
import { Id } from 'convex/_generated/dataModel';
import {
  nucleoCheck as Check,
  nucleoPhoto as Image,
  nucleoLoader as LoaderCircle,
  NucleoIcon,
  nucleoShop as Store,
  nucleoUpload as Upload,
  nucleoClose as X,
} from '@kualia/icons';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { IconService } from '../../services/icon.service';
import { LogoSearchResult, LogoSearchService } from '../../services/logo-search.service';
import { LogoUploadService } from '../../services/logo-upload.service';
import {
  DEFAULT_MERCHANT_ICON_NAME,
  ENTITY_ICON_COLORS,
  EntityIconColorId,
  VisualIdentityMode,
} from '../../shared/utils/entity-identity';
import { HlmTabsImports } from '../../ui/tabs/src';

@Component({
  selector: 'app-logo-picker',
  imports: [BrnComboboxImports, HlmComboboxImports, HlmTabsImports, NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <hlm-tabs class="gap-0" [tab]="activeMode()" (tabActivated)="onTabActivated($event)">
      <div class="border-border border-b p-2">
        <hlm-tabs-list class="grid w-full grid-cols-2">
          <button type="button" hlmTabsTrigger="logo" class="gap-2">
            <nucleo-icon [icon]="Image" [size]="14" />
            <span>Logo</span>
          </button>
          <button type="button" hlmTabsTrigger="icon" class="gap-2">
            <nucleo-icon [icon]="Store" [size]="14" />
            <span>Icon</span>
          </button>
        </hlm-tabs-list>
      </div>

      <div hlmTabsContent="logo" class="mt-0">
        <div class="border-border border-b p-2">
          <input
            type="text"
            placeholder="Try: amazon, starbucks, target, etc."
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          />
        </div>
        <div class="max-h-[400px] overflow-y-auto">
          <!-- Upload custom image button (when entityId is provided) -->
          @if (entityId()) {
            <button
              type="button"
              (click)="triggerFileInput()"
              [disabled]="isUploading()"
              class="hover:bg-accent hover:text-accent-foreground flex h-10 w-full items-center gap-2 px-2 text-sm disabled:opacity-50"
            >
              @if (isUploading()) {
                <nucleo-icon [icon]="LoaderCircle" [size]="14" class="flex-shrink-0 animate-spin" />
              } @else {
                <nucleo-icon [icon]="Upload" [size]="14" class="flex-shrink-0" />
              }
              <span>{{ isUploading() ? uploadProgressText() : 'Upload custom image' }}</span>
            </button>
            <input #fileInput type="file" accept="image/*" class="hidden" (change)="onFileSelected($event)" />
            @if (uploadError()) {
              <div class="text-destructive px-2 pb-2 text-xs">{{ uploadError() }}</div>
            }
            <div class="bg-border mx-2 my-1 h-px"></div>
          }

          @if (logoState() === 'custom') {
            <button
              type="button"
              (click)="removeDefaultLogo()"
              class="hover:bg-accent hover:text-accent-foreground text-destructive flex h-10 w-full items-center gap-2 px-2 text-sm"
            >
              <nucleo-icon [icon]="X" [size]="14" class="flex-shrink-0" />
              <div
                class="bg-accent/50 text-muted-foreground flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border"
              >
                <nucleo-icon [icon]="Store" [size]="12" />
              </div>
              <span>Remove logo</span>
            </button>
            @if (defaultLogoUrl()) {
              <button
                type="button"
                (click)="removeCustomLogo()"
                class="hover:bg-accent hover:text-accent-foreground flex h-10 w-full items-center gap-2 px-2 text-sm"
              >
                <nucleo-icon [icon]="X" [size]="14" class="flex-shrink-0" />
                @if (defaultLogoUrl()) {
                  <img
                    [src]="defaultLogoUrl()"
                    alt="Default logo"
                    class="h-6 w-6 flex-shrink-0 rounded-full object-contain"
                  />
                }
                <span>Reset to default logo</span>
              </button>
              <div class="bg-border mx-2 my-1 h-px"></div>
            }
          } @else if (logoState() === 'default') {
            <button
              type="button"
              (click)="removeDefaultLogo()"
              class="hover:bg-accent hover:text-accent-foreground flex h-10 w-full items-center gap-2 px-2 text-sm"
            >
              <nucleo-icon [icon]="X" [size]="14" class="flex-shrink-0" />
              <div
                class="bg-accent/50 text-muted-foreground flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border"
              >
                <nucleo-icon [icon]="Store" [size]="12" />
              </div>
              <span class="text-destructive">Remove logo</span>
            </button>
            <div class="bg-border mx-2 my-1 h-px"></div>
          } @else if (logoState() === 'removed' && defaultLogoUrl()) {
            <button
              type="button"
              (click)="resetDefaultLogo()"
              class="hover:bg-accent hover:text-accent-foreground flex h-10 w-full items-center gap-2 px-2 text-sm"
            >
              <nucleo-icon [icon]="X" [size]="14" class="flex-shrink-0" />
              @if (defaultLogoUrl()) {
                <img
                  [src]="defaultLogoUrl()"
                  alt="Default logo"
                  class="h-6 w-6 flex-shrink-0 rounded-full object-contain"
                />
              }
              <span>Reset to default logo</span>
            </button>
            <div class="bg-border mx-2 my-1 h-px"></div>
          }
          @if (isSearching()) {
            <div class="text-muted-foreground py-6 text-center text-sm">Searching...</div>
          } @else if (searchError()) {
            <div class="text-destructive py-6 text-center text-sm">{{ searchError() }}</div>
          } @else if (searchResults() && searchResults()!.length > 0) {
            @for (result of searchResults()!; track result.domain) {
              <button
                type="button"
                (click)="selectLogo(result)"
                class="hover:bg-accent hover:text-accent-foreground flex h-10 w-full items-center justify-between px-2 text-sm"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <img
                    [src]="result.logoUrl"
                    [alt]="result.name + ' logo'"
                    class="h-6 w-6 flex-shrink-0 rounded-full object-contain"
                  />
                  <span class="min-w-0 truncate text-left">{{ result.name }}</span>
                </div>
                <span class="text-muted-foreground flex-shrink-0 text-xs">{{ result.domain }}</span>
              </button>
            }
          } @else if (searchResults() && searchResults()!.length === 0) {
            <div class="text-muted-foreground py-6 text-center text-sm">No logos found</div>
          } @else {
            <div class="text-muted-foreground py-6 text-center text-sm">Type to search for logos...</div>
          }
        </div>
      </div>

      <div hlmTabsContent="icon" class="mt-0">
        <div class="border-border border-b p-2">
          <input
            type="text"
            placeholder="Search icons..."
            (input)="onIconSearchInput($event)"
            class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          />
        </div>
        <div class="border-border border-b p-2">
          <div class="grid grid-cols-10 gap-1">
            @for (color of entityIconColors; track color.id) {
              <button
                type="button"
                class="ring-offset-background relative h-7 w-7 rounded-full border transition-[box-shadow,transform] hover:scale-105 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                [class.ring-2]="selectedIconColorId() === color.id"
                [class.ring-primary]="selectedIconColorId() === color.id"
                [style.background-color]="color.background"
                [style.color]="color.foreground"
                [attr.aria-label]="color.label"
                [title]="color.label"
                (click)="selectIconColor(color.id)"
              >
                @if (selectedIconColorId() === color.id) {
                  <nucleo-icon
                    [icon]="Check"
                    [size]="14"
                    class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                  />
                }
              </button>
            }
          </div>
        </div>
        <div class="max-h-[330px] overflow-y-auto">
          @if (filteredIcons().length === 0) {
            <div class="text-muted-foreground py-6 text-center text-sm">No icons found.</div>
          } @else {
            <div class="grid grid-cols-[repeat(auto-fit,minmax(40px,40px))] gap-1 p-2">
              @for (iconName of filteredIcons(); track iconName) {
                @if (getIconData(iconName); as iconData) {
                  <button
                    type="button"
                    class="hover:bg-accent hover:text-accent-foreground border-border/0 flex aspect-square items-center justify-center rounded-md border transition-colors"
                    [class.bg-accent]="(selectedIconName() ?? defaultIconName()) === iconName"
                    [class.border-border]="(selectedIconName() ?? defaultIconName()) === iconName"
                    [class.text-foreground]="(selectedIconName() ?? defaultIconName()) === iconName"
                    [class.text-muted-foreground]="(selectedIconName() ?? defaultIconName()) !== iconName"
                    [attr.aria-label]="iconName"
                    [title]="iconName"
                    (click)="selectIcon(iconName)"
                  >
                    <nucleo-icon [icon]="iconData" [size]="16" />
                  </button>
                }
              }
            </div>
          }
        </div>
      </div>
    </hlm-tabs>
  `,
})
export class LogoPickerComponent implements OnDestroy {
  private readonly logoSearchService = inject(LogoSearchService);
  private readonly logoUploadService = inject(LogoUploadService);
  private readonly iconService = inject(IconService);

  readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');

  readonly isOpen = input<boolean>(false);
  readonly currentLogoUrl = input<string | undefined>(undefined);
  readonly defaultLogoUrl = input<string | undefined>(undefined);
  readonly logoState = input<'custom' | 'default' | 'removed' | 'no-logo' | 'no-merchant'>('no-logo');
  readonly entityType = input<'merchant' | 'bankAccount'>('merchant');
  readonly entityId = input<Id<'merchant'> | Id<'bankAccount'> | undefined>(undefined);
  readonly pickerMode = input<VisualIdentityMode>('logo');
  readonly selectedIconName = input<string | null | undefined>(undefined);
  readonly selectedIconColorId = input<EntityIconColorId | null | undefined>(undefined);
  readonly defaultIconName = input<string>(DEFAULT_MERCHANT_ICON_NAME);

  readonly logoSelected = output<string | null>();
  readonly customImageUploaded = output<string>();
  readonly removeCustomRequested = output<void>();
  readonly removeDefaultRequested = output<void>();
  readonly resetDefaultRequested = output<void>();
  readonly modeChange = output<VisualIdentityMode>();
  readonly iconSelected = output<string>();
  readonly iconColorSelected = output<EntityIconColorId>();
  readonly closeRequested = output<void>();

  readonly searchQuery = signal<string>('');
  readonly searchResults = signal<LogoSearchResult[] | null>(null);
  readonly isSearching = signal<boolean>(false);
  readonly searchError = signal<string | null>(null);
  readonly uploadError = signal<string | null>(null);
  readonly activeMode = signal<VisualIdentityMode>('logo');

  readonly uploadProgress = this.logoUploadService.uploadProgress;
  readonly isUploading = computed(() => {
    const status = this.uploadProgress().status;
    return status === 'uploading' || status === 'saving';
  });
  readonly uploadProgressText = computed(() => {
    const progress = this.uploadProgress();
    if (progress.status === 'uploading') return 'Uploading...';
    if (progress.status === 'saving') return 'Saving...';
    return 'Upload custom image';
  });

  protected readonly X = X;
  protected readonly Store = Store;
  protected readonly Image = Image;
  protected readonly Upload = Upload;
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Check = Check;
  protected readonly entityIconColors = ENTITY_ICON_COLORS;
  protected readonly filteredIcons = computed(() => this.iconService.filteredIcons());
  private searchSubject = new Subject<string>();

  constructor() {
    this.searchSubject.pipe(debounceTime(300), distinctUntilChanged()).subscribe((query) => {
      void this.performSearch(query);
    });

    effect(() => {
      this.activeMode.set(this.pickerMode());
    });

    effect(() => {
      if (!this.isOpen()) {
        this.searchQuery.set('');
        this.searchResults.set(null);
        this.searchError.set(null);
        this.uploadError.set(null);
        this.logoUploadService.resetProgress();
        this.iconService.setSearchQuery('');
      }
    });
  }

  ngOnDestroy(): void {
    this.searchSubject.complete();
  }

  triggerFileInput(): void {
    const input = this.fileInput()?.nativeElement;
    if (input) {
      input.click();
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    // Reset file input for future selections
    input.value = '';

    const entityType = this.entityType();
    const entityId = this.entityId();

    if (!entityId) {
      this.uploadError.set('Entity ID is required for upload');
      return;
    }

    // Validate file
    const validation = this.logoUploadService.validateFile(file);
    if (!validation.valid) {
      this.uploadError.set(validation.error ?? 'Invalid file');
      return;
    }

    this.uploadError.set(null);

    try {
      const url = await this.logoUploadService.uploadLogo(file, entityType, entityId);
      this.customImageUploaded.emit(url);
      this.closeRequested.emit();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Upload failed';
      this.uploadError.set(errorMessage);
    }
  }

  onSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);
    if (query.trim().length >= 2) {
      this.searchSubject.next(query);
    } else {
      this.searchResults.set(null);
      this.searchError.set(null);
    }
  }

  onIconSearchInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.iconService.setSearchQuery(query);
  }

  selectMode(mode: VisualIdentityMode): void {
    const currentMode = this.activeMode();
    if (currentMode === mode) {
      return;
    }

    this.activeMode.set(mode);
    this.modeChange.emit(mode);
  }

  onTabActivated(tab: unknown): void {
    if (tab === 'logo' || tab === 'icon') {
      this.selectMode(tab);
    }
  }

  selectIcon(iconName: string): void {
    this.iconSelected.emit(iconName);
  }

  selectIconColor(colorId: EntityIconColorId): void {
    this.iconColorSelected.emit(colorId);
  }

  getIconData(iconName: string) {
    return this.iconService.getIconByName(iconName);
  }

  private async performSearch(query: string): Promise<void> {
    this.isSearching.set(true);
    this.searchError.set(null);

    try {
      const results = await this.logoSearchService.searchLogos(query);
      this.searchResults.set(results);
    } catch {
      this.searchError.set('Failed to search logos');
    } finally {
      this.isSearching.set(false);
    }
  }

  selectLogo(result: LogoSearchResult): void {
    this.logoSelected.emit(result.logoUrl);
    this.closeRequested.emit();
  }

  removeCustomLogo(): void {
    this.removeCustomRequested.emit();
    this.closeRequested.emit();
  }

  removeDefaultLogo(): void {
    this.removeDefaultRequested.emit();
    this.closeRequested.emit();
  }

  resetDefaultLogo(): void {
    this.resetDefaultRequested.emit();
    this.closeRequested.emit();
  }
}
