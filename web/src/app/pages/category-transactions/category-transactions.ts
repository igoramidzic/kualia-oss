import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TransactionsTableComponent } from '../../components/transactions-table/transactions-table';
import { CategoryOverviewPageService } from '../category-details/category-overview-page.service';

@Component({
  selector: 'app-category-transactions',
  imports: [TransactionsTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './category-transactions.html',
  host: {
    class: 'block h-full',
  },
})
export class CategoryTransactionsComponent {
  private readonly categoryPageService = inject(CategoryOverviewPageService);

  readonly category = this.categoryPageService.category;
  readonly transactions = this.categoryPageService.sortedTransactions;
  readonly loading = this.categoryPageService.transactionsLoading;
  readonly error = this.categoryPageService.error;
}
