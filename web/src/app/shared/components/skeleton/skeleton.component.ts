import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-skeleton',
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="bg-accent animate-pulse rounded-md"
      [class]="className()"
      [style.width]="width()"
      [style.height]="height()"
    ></div>
  `,
})
export class SkeletonComponent {
  className = input<string>('');
  width = input<string>('');
  height = input<string>('');
}
