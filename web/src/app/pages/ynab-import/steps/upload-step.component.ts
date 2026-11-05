import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import {
  nucleoCheck as Check,
  nucleoTable as FileSpreadsheet,
  NucleoIcon,
  nucleoUpload as Upload,
} from '@kualia/icons';

@Component({
  selector: 'app-upload-step',
  imports: [NucleoIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-6">
      <!-- Instructions -->
      <div class="bg-muted/50 rounded-lg p-4 text-sm">
        <h3 class="mb-2 font-medium">How to export from YNAB:</h3>
        <ol class="text-muted-foreground list-inside list-decimal space-y-1">
          <li>Open YNAB and go to your budget</li>
          <li>Click the export icon in the top toolbar</li>
          <li>Download both the "Budget" (plan.csv) and "Register" (register.csv) files</li>
        </ol>
      </div>

      <!-- Plan CSV Upload -->
      <button
        type="button"
        class="border-border hover:border-primary/50 relative flex w-full cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors"
        [class.border-primary]="planFileName()"
        [class.bg-primary/5]="planFileName()"
        (click)="planInput.click()"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event, 'plan')"
      >
        <input #planInput type="file" accept=".csv" class="hidden" (change)="onFileSelected($event, 'plan')" />

        @if (planFileName()) {
          <div class="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
            <nucleo-icon [icon]="Check" class="text-primary h-8 w-8" />
          </div>
          <div class="text-center">
            <p class="text-primary font-medium">plan.csv uploaded</p>
            <p class="text-muted-foreground text-sm">Click to replace</p>
          </div>
        } @else {
          <div class="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
            <nucleo-icon [icon]="FileSpreadsheet" class="text-muted-foreground h-8 w-8" />
          </div>
          <div class="text-center">
            <p class="font-medium">Upload plan.csv</p>
            <p class="text-muted-foreground text-sm">Budget assignments and category targets</p>
          </div>
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <nucleo-icon [icon]="Upload" class="h-4 w-4" />
            <span>Click or drag and drop</span>
          </div>
        }
      </button>

      <!-- Register CSV Upload -->
      <button
        type="button"
        class="border-border hover:border-primary/50 relative flex w-full cursor-pointer flex-col items-center gap-4 rounded-xl border-2 border-dashed p-8 transition-colors"
        [class.border-primary]="registerFileName()"
        [class.bg-primary/5]="registerFileName()"
        (click)="registerInput.click()"
        (dragover)="onDragOver($event)"
        (drop)="onDrop($event, 'register')"
      >
        <input #registerInput type="file" accept=".csv" class="hidden" (change)="onFileSelected($event, 'register')" />

        @if (registerFileName()) {
          <div class="bg-primary/10 flex h-16 w-16 items-center justify-center rounded-full">
            <nucleo-icon [icon]="Check" class="text-primary h-8 w-8" />
          </div>
          <div class="text-center">
            <p class="text-primary font-medium">register.csv uploaded</p>
            <p class="text-muted-foreground text-sm">Click to replace</p>
          </div>
        } @else {
          <div class="bg-muted flex h-16 w-16 items-center justify-center rounded-full">
            <nucleo-icon [icon]="FileSpreadsheet" class="text-muted-foreground h-8 w-8" />
          </div>
          <div class="text-center">
            <p class="font-medium">Upload register.csv</p>
            <p class="text-muted-foreground text-sm">All your transactions</p>
          </div>
          <div class="text-muted-foreground flex items-center gap-2 text-sm">
            <nucleo-icon [icon]="Upload" class="h-4 w-4" />
            <span>Click or drag and drop</span>
          </div>
        }
      </button>
    </div>
  `,
})
export class UploadStepComponent {
  protected readonly FileSpreadsheet = FileSpreadsheet;
  protected readonly Upload = Upload;
  protected readonly Check = Check;

  readonly planFileName = input<string | null>(null);
  readonly registerFileName = input<string | null>(null);

  readonly planFileSelected = output<string>();
  readonly registerFileSelected = output<string>();

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent, type: 'plan' | 'register'): void {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.readFile(files[0], type);
    }
  }

  onFileSelected(event: Event, type: 'plan' | 'register'): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.readFile(input.files[0], type);
    }
  }

  private readFile(file: File, type: 'plan' | 'register'): void {
    const reader = new FileReader();
    reader.onload = () => {
      const content = reader.result as string;
      if (type === 'plan') {
        this.planFileSelected.emit(content);
      } else {
        this.registerFileSelected.emit(content);
      }
    };
    reader.readAsText(file);
  }
}
