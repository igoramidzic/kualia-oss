// Temporary debug helper - you can delete this file after debugging

import { inject } from '@angular/core';
import { TransactionService } from './transaction.service';

export function debugTransactionCounts() {
  const service = inject(TransactionService);

  // Debug function - console logs removed
  // Uncomment and add logging if needed for debugging
  void service.pendingCount();
  void service.needsReviewCount();
  void service.loadingStatusCounts();
  void service.statusCounts();
}
