import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard } from '@spartan-ng/helm/card';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import {
  nucleoArrowDown as ArrowDown,
  nucleoArrowRight as ArrowRight,
  NucleoIcon,
  nucleoPlus as Plus,
  nucleoShop as Store,
} from '@kualia/icons';
import { RuleDialogComponent } from '../../../components/dialogs/rule-dialog/rule-dialog';
import { SettingsPageHeaderComponent } from '../../../components/settings-page-header/settings-page-header';
import { Category, CategoryService } from '../../../services/category.service';
import { Merchant, MerchantService } from '../../../services/merchant.service';
import { RuleService } from '../../../services/rule.service';
import { TransactionRule } from '../../../types/transaction-rule.types';

interface RuleAction {
  label: string;
  value: string;
  type: 'merchant' | 'category';
  logoUrl?: string;
}

@Component({
  selector: 'app-rules',
  imports: [NucleoIcon, HlmButton, HlmCard, SettingsPageHeaderComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rules.html',
  host: {
    class: 'block h-full',
  },
})
export class RulesComponent {
  protected readonly Plus = Plus;
  protected readonly ArrowRight = ArrowRight;
  protected readonly ArrowDown = ArrowDown;
  protected readonly Store = Store;

  private readonly ruleService = inject(RuleService);
  private readonly merchantService = inject(MerchantService);
  private readonly categoryService = inject(CategoryService);
  private readonly dialogService = inject(HlmDialogService);

  readonly rules = this.ruleService.rules;

  private readonly dataReady = computed(() => this.merchantService.hasLoaded() && this.categoryService.hasLoaded());

  readonly loading = computed(() => this.ruleService.loading() || !this.dataReady());

  formatConditions(rule: TransactionRule): string[] {
    const conditions: string[] = [];
    const formatMatchType = (type: string): string => (type === 'contains' ? 'contains' : 'exactly matches');

    for (const cond of rule.conditions.originalStatement ?? []) {
      conditions.push(`statement ${formatMatchType(cond.matchType)} "${cond.value}"`);
    }

    for (const cond of rule.conditions.merchantName ?? []) {
      conditions.push(`merchant ${formatMatchType(cond.matchType)} "${cond.value}"`);
    }

    return conditions.length > 0 ? conditions : ['No conditions'];
  }

  formatActions(rule: TransactionRule): RuleAction[] {
    const actions: RuleAction[] = [];

    if (rule.actions.setMerchantId) {
      const merchant = this.merchantService.merchants().find((m: Merchant) => m._id === rule.actions.setMerchantId);
      actions.push({
        label: 'Set merchant to',
        value: merchant?.name ?? 'Unknown Merchant',
        type: 'merchant',
        logoUrl: merchant?.logoUrl,
      });
    }

    if (rule.actions.setCategoryId) {
      const category = this.categoryService.categories().find((c: Category) => c._id === rule.actions.setCategoryId);
      actions.push({
        label: actions.length === 0 ? 'Set category to' : 'set category to',
        value: category?.name ?? 'Unknown Category',
        type: 'category',
      });
    }

    return actions;
  }

  openCreateRuleDialog(): void {
    this.dialogService.open(RuleDialogComponent, {
      context: {
        close: () => {
          /* handled by dialog */
        },
      },
      contentClass: 'sm:max-w-4xl',
    });
  }

  openEditRuleDialog(rule: TransactionRule): void {
    this.dialogService.open(RuleDialogComponent, {
      context: {
        rule,
        close: () => {
          /* handled by dialog */
        },
      },
      contentClass: 'sm:max-w-4xl',
    });
  }
}
