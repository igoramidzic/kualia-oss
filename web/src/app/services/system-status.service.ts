import { computed, inject, Injectable, signal } from '@angular/core';
import { api } from '../../../../convex/_generated/api';
import { ConvexService } from './convex.service';

interface SystemStatus {
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  minIosVersion: string | null;
  iosUpdateMessage: string | null;
}

/**
 * Service to check system status (maintenance mode).
 * This service does NOT require authentication.
 */
@Injectable({
  providedIn: 'root',
})
export class SystemStatusService {
  private readonly convex = inject(ConvexService);

  private readonly _status = signal<SystemStatus | null>(null);
  private readonly _hasLoaded = signal(false);
  private unsubscribe?: () => void;

  readonly hasLoaded = this._hasLoaded.asReadonly();

  readonly isMaintenanceMode = computed(() => {
    const status = this._status();
    return status?.maintenanceMode ?? false;
  });

  readonly maintenanceMessage = computed(() => {
    const status = this._status();
    return status?.maintenanceMessage ?? null;
  });

  /**
   * Start watching system status.
   * Call this BEFORE authentication check.
   */
  startWatching() {
    if (this.unsubscribe) {
      return; // Already watching
    }

    const client = this.convex.getClient();

    this.unsubscribe = client.onUpdate(
      api.systemStatus.queries.getSystemStatus,
      {},
      (status: SystemStatus) => {
        this._status.set(status);
        this._hasLoaded.set(true);
      },
      () => {
        // On error, assume system is operational (fail-open for web)
        this._status.set({
          maintenanceMode: false,
          maintenanceMessage: null,
          minIosVersion: null,
          iosUpdateMessage: null,
        });
        this._hasLoaded.set(true);
      }
    );
  }

  stopWatching() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }
}
