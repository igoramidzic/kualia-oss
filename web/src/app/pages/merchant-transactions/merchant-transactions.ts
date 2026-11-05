import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TransactionsTableComponent } from '../../components/transactions-table/transactions-table';
import { MerchantPageService } from '../merchant/merchant-page.service';

@Component({
  selector: 'app-merchant-transactions',
  imports: [TransactionsTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './merchant-transactions.html',
  host: {
    class: 'block h-full',
  },
})
export class MerchantTransactionsComponent {
  private readonly merchantPageService = inject(MerchantPageService);

  readonly merchant = this.merchantPageService.merchant;
  readonly transactions = this.merchantPageService.sortedTransactions;
  readonly loading = this.merchantPageService.transactionsLoading;
  readonly error = this.merchantPageService.error;
}
