import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, Injectable, inject } from '@angular/core';
import { api } from 'convex/_generated/api';
import type { CheckIn } from 'convex/userProfiles/types';
import { LocalAuthService } from './local-auth.service';
import { ConvexService } from './convex.service';

@Injectable({ providedIn: 'root' })
export class CheckInService {
  private readonly convex = inject(ConvexService);
  private readonly clerk = inject(LocalAuthService);
  private readonly document = inject(DOCUMENT);
  private sessionKey: string | null = null;
  private generation = 0;
  private pending = false;
  private recorded?: CheckIn;

  constructor() {
    effect(() => {
      const session = this.clerk.session();
      const key = this.convex.isAuthenticated() && session ? session.userId : null;
      if (key !== this.sessionKey) {
        this.sessionKey = key;
        this.generation += 1;
        this.pending = false;
        this.recorded = undefined;
      }
      void this.record();
    });
    const record = () => void this.record();
    const window = this.document.defaultView;
    this.document.addEventListener('visibilitychange', record);
    window?.addEventListener('focus', record);
    window?.addEventListener('online', record);
    // Also handle a visible tab left open across midnight, and retry failed visits.
    const timer = window?.setInterval(record, 60_000);
    inject(DestroyRef).onDestroy(() => {
      this.sessionKey = null;
      this.generation += 1;
      this.document.removeEventListener('visibilitychange', record);
      window?.removeEventListener('focus', record);
      window?.removeEventListener('online', record);
      window?.clearInterval(timer);
    });
  }

  private async record(): Promise<void> {
    if (!this.sessionKey || this.pending || this.document.visibilityState !== 'visible') return;
    if (this.recorded) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: this.recorded.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(new Date());
      const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
      const today = `${value('year')}-${value('month')}-${value('day')}`;
      if (today <= this.recorded.lastDate) return;
    }
    const generation = this.generation;
    this.pending = true;
    try {
      await this.convex.ensureCurrentUserProfile();
      if (generation !== this.generation || this.document.visibilityState !== 'visible') return;
      const result = await this.convex.getClient().mutation(api.userProfiles.recordCheckIn, {
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (generation === this.generation) this.recorded = result;
    } catch (_error: unknown) {
      // A failed visit remains eligible on focus, reconnect, or the next minute.
    } finally {
      if (generation === this.generation) this.pending = false;
    }
  }
}
