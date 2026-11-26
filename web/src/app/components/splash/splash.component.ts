import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import {
  kualiaWarningCircle as AlertCircle,
  kualiaLoader as LoaderCircle,
  KualiaIcon,
  kualiaRefresh as RefreshCw,
} from '@kualia/icons';

@Component({
  selector: 'app-splash',
  templateUrl: './splash.component.html',
  imports: [HlmButton, KualiaIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplashComponent {
  protected readonly AlertCircle = AlertCircle;
  protected readonly RefreshCw = RefreshCw;
  protected readonly LoaderCircle = LoaderCircle;

  readonly initializationError = input<string | null>(null);
  readonly isRetrying = input<boolean>(false);

  readonly retry = output<void>();

  onRetryClick() {
    this.retry.emit();
  }
}
