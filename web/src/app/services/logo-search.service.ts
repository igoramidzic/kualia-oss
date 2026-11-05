import { Injectable, inject } from '@angular/core';
import { api } from 'convex/_generated/api';
import { ConvexService } from './convex.service';

export interface LogoSearchResult {
  name: string;
  domain: string;
  logoUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class LogoSearchService {
  private readonly convex = inject(ConvexService);
  private readonly searchCache = new Map<string, LogoSearchResult[]>();

  async searchLogos(query: string): Promise<LogoSearchResult[]> {
    if (!query.trim()) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    const cached = this.searchCache.get(normalizedQuery);
    if (cached) {
      return cached;
    }

    try {
      const results = await this.convex.action<LogoSearchResult[]>(api.logoDev.searchLogos, {
        query,
      });

      this.searchCache.set(normalizedQuery, results);
      return results;
    } catch (error) {
      console.error('Failed to search logos:', error);
      return [];
    }
  }
}
