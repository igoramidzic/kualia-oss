import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButton } from '@spartan-ng/helm/button';
import { HlmCard, HlmCardContent } from '@spartan-ng/helm/card';
import { HlmCheckboxImports } from '@spartan-ng/helm/checkbox';
import { HlmDialogFooter } from '@spartan-ng/helm/dialog';
import { HlmInput } from '@spartan-ng/helm/input';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { Id } from 'convex/_generated/dataModel';
import { nucleoLoader as LoaderCircle, NucleoIcon, nucleoTrash as Trash2, nucleoClose as X } from '@kualia/icons';
import { toast } from 'ngx-sonner';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { RuleService } from '../../../services/rule.service';
import { TransactionService } from '../../../services/transaction.service';
import { extractConvexErrorMessage } from '../../../shared/utils/convex-error-message';
import { MatchType, TransactionRule } from '../../../types/transaction-rule.types';
import { HlmAccordionImports } from '../../../ui/accordion/src';
import { HlmSwitchImports } from '../../../ui/switch/src';
import { RuleCategoryPickerComponent } from './category-picker.component';
import { RuleMerchantPickerComponent } from './merchant-picker.component';

interface StringConditionForm {
  enabled: boolean;
  matchType: MatchType;
  value: string;
}

interface MerchantActionForm {
  enabled: boolean;
  merchantId: Id<'merchant'> | null;
}

interface CategoryActionForm {
  enabled: boolean;
  categoryId: Id<'category'> | null;
}

@Component({
  selector: 'app-rule-dialog',
  imports: [
    FormsModule,
    HlmButton,
    HlmCheckboxImports,
    HlmDialogFooter,
    HlmInput,
    ...HlmSwitchImports,
    NucleoIcon,
    HlmSelectImports,
    ...HlmAccordionImports,
    HlmCard,
    HlmCardContent,
    RuleCategoryPickerComponent,
    RuleMerchantPickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rule-dialog.html',
})
export class RuleDialogComponent {
  protected readonly LoaderCircle = LoaderCircle;
  protected readonly Trash2 = Trash2;
  protected readonly X = X;

  private readonly ruleService = inject(RuleService);
  private readonly transactionService = inject(TransactionService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly dialogContext = injectBrnDialogContext<{
    close: (result?: TransactionRule) => void;
    rule?: TransactionRule | Partial<TransactionRule>;
  }>();

  readonly isEditMode = computed(() => {
    const rule = this.dialogContext.rule;
    return !!(rule && '_id' in rule && rule._id);
  });
  readonly dialogTitle = computed(() => (this.isEditMode() ? 'Update Rule' : 'New Rule'));

  readonly saving = signal<boolean>(false);
  readonly deleting = signal<boolean>(false);
  readonly confirmingDelete = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly matchedCount = signal<number | null>(null);
  readonly countingMatches = signal<boolean>(false);
  readonly applyToExisting = signal<boolean>(false);

  private conditionsChanged$ = new Subject<void>();

  readonly originalStatementCondition = signal<StringConditionForm>({
    enabled: false,
    matchType: 'contains',
    value: '',
  });

  readonly merchantNameCondition = signal<StringConditionForm>({
    enabled: false,
    matchType: 'contains',
    value: '',
  });

  readonly merchantAction = signal<MerchantActionForm>({
    enabled: false,
    merchantId: null,
  });

  readonly categoryAction = signal<CategoryActionForm>({
    enabled: false,
    categoryId: null,
  });

  readonly canSave = computed(() => {
    const originalStmt = this.originalStatementCondition();
    const merchantName = this.merchantNameCondition();

    const hasValidOriginalStmt = originalStmt.enabled && originalStmt.value.trim().length > 0;
    const hasValidMerchantName = merchantName.enabled && merchantName.value.trim().length > 0;
    const hasValidCondition = hasValidOriginalStmt || hasValidMerchantName;

    const merchantAct = this.merchantAction();
    const categoryAct = this.categoryAction();

    const hasValidMerchantAction = merchantAct.enabled && merchantAct.merchantId !== null;
    const hasValidCategoryAction = categoryAct.enabled && categoryAct.categoryId !== null;
    const hasValidAction = hasValidMerchantAction || hasValidCategoryAction;

    return hasValidCondition && hasValidAction && !this.saving();
  });

  constructor() {
    const rule = this.dialogContext.rule;
    if (rule) {
      this.loadRuleData(rule);
    }

    this.conditionsChanged$.pipe(debounceTime(500), takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      void this.updateMatchCount();
    });

    effect(() => {
      if (!this.isEditMode()) {
        this.originalStatementCondition();
        this.merchantNameCondition();
        this.conditionsChanged$.next();
      }
    });
  }

  private loadRuleData(rule: TransactionRule | Partial<TransactionRule>): void {
    if (rule.conditions?.originalStatement?.[0]) {
      const condition = rule.conditions.originalStatement[0];
      this.originalStatementCondition.set({
        enabled: true,
        matchType: condition.matchType,
        value: condition.value,
      });
    }

    if (rule.conditions?.merchantName?.[0]) {
      const condition = rule.conditions.merchantName[0];
      this.merchantNameCondition.set({
        enabled: true,
        matchType: condition.matchType,
        value: condition.value,
      });
    }

    if (rule.actions?.setMerchantId) {
      this.merchantAction.set({
        enabled: true,
        merchantId: rule.actions.setMerchantId,
      });
    }

    if (rule.actions?.setCategoryId) {
      this.categoryAction.set({
        enabled: true,
        categoryId: rule.actions.setCategoryId,
      });
    }
  }

  toggleOriginalStatement(): void {
    this.originalStatementCondition.update((current) => ({ ...current, enabled: !current.enabled }));
  }

  updateOriginalStatementMatchType(matchType: MatchType | null | undefined): void {
    if (!matchType) return;

    this.originalStatementCondition.update((current) => ({ ...current, matchType }));
  }

  updateOriginalStatementValue(value: string): void {
    this.originalStatementCondition.update((current) => ({ ...current, value }));
  }

  toggleMerchantName(): void {
    this.merchantNameCondition.update((current) => ({ ...current, enabled: !current.enabled }));
  }

  updateMerchantNameMatchType(matchType: MatchType | null | undefined): void {
    if (!matchType) return;

    this.merchantNameCondition.update((current) => ({ ...current, matchType }));
  }

  updateMerchantNameValue(value: string): void {
    this.merchantNameCondition.update((current) => ({ ...current, value }));
  }

  toggleMerchant(): void {
    this.merchantAction.update((current) => ({ ...current, enabled: !current.enabled }));
  }

  onMerchantActionChange(merchantId: Id<'merchant'>): void {
    this.merchantAction.update((current) => ({ ...current, merchantId }));
  }

  toggleCategory(): void {
    this.categoryAction.update((current) => ({ ...current, enabled: !current.enabled }));
  }

  updateCategoryActionValue(categoryId: Id<'category'>): void {
    this.categoryAction.update((current) => ({ ...current, categoryId }));
  }

  private getMatchTypeLabel(matchType: MatchType): string {
    return matchType === 'exactlyMatches' ? 'Exactly Matches' : 'Contains';
  }

  private async updateMatchCount(): Promise<void> {
    if (this.isEditMode()) {
      this.matchedCount.set(null);
      return;
    }

    const originalStmt = this.originalStatementCondition();
    const merchantName = this.merchantNameCondition();

    const hasValidOriginalStmt = originalStmt.enabled && originalStmt.value.trim().length > 0;
    const hasValidMerchantName = merchantName.enabled && merchantName.value.trim().length > 0;

    if (!hasValidOriginalStmt && !hasValidMerchantName) {
      this.matchedCount.set(null);
      return;
    }

    try {
      this.countingMatches.set(true);

      const conditions: {
        originalStatement?: { matchType: MatchType; value: string }[];
        merchantName?: { matchType: MatchType; value: string }[];
      } = {};

      if (hasValidOriginalStmt) {
        conditions.originalStatement = [
          {
            matchType: originalStmt.matchType,
            value: originalStmt.value.trim(),
          },
        ];
      }

      if (hasValidMerchantName) {
        conditions.merchantName = [
          {
            matchType: merchantName.matchType,
            value: merchantName.value.trim(),
          },
        ];
      }

      const count = await this.ruleService.countMatchingTransactions(conditions);
      this.matchedCount.set(count);
    } catch (err) {
      console.error('Error counting matching transactions:', err);
      this.matchedCount.set(null);
    } finally {
      this.countingMatches.set(false);
    }
  }

  toggleApplyToExisting(checked: boolean): void {
    this.applyToExisting.set(checked);
  }

  async save(): Promise<void> {
    try {
      this.saving.set(true);
      this.error.set(null);

      const conditions: {
        originalStatement?: { matchType: MatchType; value: string }[];
        merchantName?: { matchType: MatchType; value: string }[];
      } = {};

      const originalStmt = this.originalStatementCondition();
      if (originalStmt.enabled && originalStmt.value.trim()) {
        conditions.originalStatement = [
          {
            matchType: originalStmt.matchType,
            value: originalStmt.value.trim(),
          },
        ];
      }

      const merchantName = this.merchantNameCondition();
      if (merchantName.enabled && merchantName.value.trim()) {
        conditions.merchantName = [
          {
            matchType: merchantName.matchType,
            value: merchantName.value.trim(),
          },
        ];
      }

      const actions: {
        setMerchantId?: string;
        setCategoryId?: string;
      } = {};

      const merchantAct = this.merchantAction();
      if (merchantAct.enabled && merchantAct.merchantId) {
        actions.setMerchantId = merchantAct.merchantId;
      }

      const categoryAct = this.categoryAction();
      if (categoryAct.enabled && categoryAct.categoryId) {
        actions.setCategoryId = categoryAct.categoryId;
      }

      if (this.isEditMode()) {
        const rule = this.dialogContext.rule!;
        if (!rule || !('_id' in rule) || !rule._id) {
          throw new Error('Cannot update rule without ID');
        }
        await this.ruleService.updateRule(rule._id, {
          conditions,
          actions,
        });
        toast.success('Rule updated');
      } else {
        const ruleId = await this.ruleService.createRule({
          name: this.generateRuleName(),
          isActive: true,
          conditions,
          actions,
        });

        if (this.applyToExisting() && ruleId) {
          const appliedCount = await this.ruleService.applyToExisting(ruleId);

          if (appliedCount > 0) {
            void this.transactionService.refresh();
            toast.success(
              `Rule created and applied to ${appliedCount} ${appliedCount === 1 ? 'transaction' : 'transactions'}`
            );
          } else {
            toast.success('Rule created');
          }
        } else {
          toast.success('Rule created');
        }
      }

      this.dialogContext.close();
    } catch (err: unknown) {
      console.error('Error saving rule:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to save rule'));
    } finally {
      this.saving.set(false);
    }
  }

  private generateRuleName(): string {
    const parts: string[] = [];

    const originalStmt = this.originalStatementCondition();
    if (originalStmt.enabled && originalStmt.value.trim()) {
      parts.push(`Statement ${this.getMatchTypeLabel(originalStmt.matchType).toLowerCase()} "${originalStmt.value}"`);
    }

    const merchantName = this.merchantNameCondition();
    if (merchantName.enabled && merchantName.value.trim()) {
      parts.push(`Merchant ${this.getMatchTypeLabel(merchantName.matchType).toLowerCase()} "${merchantName.value}"`);
    }

    return parts.join(' and ') || 'New Rule';
  }

  promptDelete(): void {
    this.confirmingDelete.set(true);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  async confirmDelete(): Promise<void> {
    if (!this.isEditMode()) return;

    try {
      this.deleting.set(true);
      this.error.set(null);

      const rule = this.dialogContext.rule!;
      if (!rule || !('_id' in rule) || !rule._id) {
        throw new Error('Cannot delete rule without ID');
      }
      await this.ruleService.deleteRule(rule._id);
      toast.success('Rule deleted');

      this.dialogContext.close();
    } catch (err: unknown) {
      console.error('Error deleting rule:', err);
      this.error.set(extractConvexErrorMessage(err, 'Failed to delete rule'));
      this.confirmingDelete.set(false);
    } finally {
      this.deleting.set(false);
    }
  }
}
