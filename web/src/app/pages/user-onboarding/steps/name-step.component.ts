import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HlmInput } from '../../../ui/input/src';

@Component({
  selector: 'app-name-step',
  imports: [FormsModule, HlmInput],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-6">
      <input
        hlmInput
        type="text"
        placeholder="Enter your first name"
        class="w-full text-lg"
        [ngModel]="name()"
        (ngModelChange)="nameChange.emit($event)"
        (keydown.enter)="onEnter()"
      />
      <p class="text-muted-foreground text-sm">This will be used to personalize your experience in Kualia.</p>
    </div>
  `,
})
export class NameStepComponent {
  readonly name = input.required<string>();
  readonly nameChange = output<string>();
  readonly enterPressed = output<void>();

  onEnter(): void {
    if (this.name().trim()) {
      this.enterPressed.emit();
    }
  }
}
