import { getIdentity } from '../../lib/identity';
import { ConvexError, v } from 'convex/values';
import { CountryCode } from 'plaid';

import { api, internal } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';
import type { ActionCtx } from '../../_generated/server';
import { action, internalMutation } from '../../_generated/server';
import { buildActivityContext, recordBankConnectionActivity } from '../../activityLogs/helpers';
import { activityAttributionValidator } from '../../activityLogs/types';
import { requireWorkspaceAccessAction } from '../../lib/auth';
import { cleanBase64String } from '../../lib/logoUtils';
import { accountType } from '../../schema';
import { getSafePlaidErrorDetails, plaidClient } from './plaidClient';

type LinkNewPlaidItemArgs = {
  publicToken: string;
  institutionId: string;
  institutionName: string;
  workspaceId: Id<'workspace'>;
  initialBalanceDate?: string; // ISO date string (YYYY-MM-DD)
  accounts: Array<{
    id: string;
    name: string;
    type: string;
    subtype: string;
    mask: string;
  }>;
};

type LinkNewPlaidItemResult = {
  success: boolean;
  bankLinkId: string;
  globalInstitutionId: string;
  accountsLinked: number;
  accounts: Array<{
    bankLinkAccountId: string;
    name: string;
    mask: string | null;
  }>;
};

export const finalizePlaidBankConnection = internalMutation({
  args: {
    workspaceId: v.id('workspace'),
    accessToken: v.string(),
    globalInstitutionId: v.id('globalInstitution'),
    itemId: v.string(),
    ownerId: v.string(),
    initialBalanceDate: v.optional(v.string()),
    accounts: v.array(
      v.object({
        accountNumberMask: v.optional(v.string()),
        accountType,
        availableBalance: v.optional(v.number()),
        initialBalance: v.number(),
        name: v.string(),
        officialName: v.optional(v.string()),
        plaidAccountId: v.string(),
      })
    ),
    attribution: activityAttributionValidator,
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const bankLinkId = await ctx.db.insert('bankLink', {
      accessToken: args.accessToken,
      globalInstitutionId: args.globalInstitutionId,
      itemId: args.itemId,
      itemStatus: 'Healthy',
      ownerId: args.ownerId,
      provider: 'plaid',
      initialBalanceDate: args.initialBalanceDate,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
      hasCompletedFirstSync: false,
      webhookMigrationStatus: 'not_needed',
    });

    const accountIds: Id<'bankLinkAccount'>[] = [];
    for (const account of args.accounts) {
      accountIds.push(
        await ctx.db.insert('bankLinkAccount', {
          ...account,
          bankLinkId,
          updatedAt: now,
          isDeleted: false,
        })
      );
    }

    const institution = await ctx.db.get(args.globalInstitutionId);
    await recordBankConnectionActivity(ctx, {
      workspaceId: args.workspaceId,
      context: await buildActivityContext(ctx, args.attribution),
      type: 'bank_connection_added',
      connection: {
        id: bankLinkId,
        provider: 'plaid',
        institutionName: institution?.name ?? 'Bank connection',
        accountNames: args.accounts.map((account) => account.name),
      },
    });

    return { bankLinkId, accountIds };
  },
});

/**
 * Link a new Plaid item (bank account) after successful Plaid Link flow
 * This exchanges the public token for an access token and stores bank account information
 */
export const linkNewPlaidItem = action({
  args: {
    publicToken: v.string(),
    institutionId: v.string(),
    institutionName: v.string(),
    workspaceId: v.id('workspace'),
    initialBalanceDate: v.optional(v.string()), // Optional - will be calculated from transactions
    accounts: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        type: v.string(),
        subtype: v.string(),
        mask: v.string(),
      })
    ),
  },
  handler: async (ctx: ActionCtx, args: LinkNewPlaidItemArgs): Promise<LinkNewPlaidItemResult> => {
    // Get the current user identity from Clerk
    const identity = await getIdentity(ctx);

    if (!identity) {
      throw new ConvexError('User not authenticated');
    }

    await requireWorkspaceAccessAction(ctx, args.workspaceId);

    // Check for duplicate bank link (bank links are cross-workspace, checked by user)
    const accountMasks = args.accounts.map((acc) => acc.mask);
    const duplicateCheck = await ctx.runQuery(api.bankLinks.checkDuplicateBankLink, {
      institutionId: args.institutionId,
      accountMasks,
    });

    if (duplicateCheck.hasDuplicate) {
      throw new ConvexError(
        `One or more accounts from ${duplicateCheck.institutionName ?? args.institutionName} are already connected. Please disconnect the existing connection before reconnecting.`
      );
    }

    try {
      // Exchange public token for access token
      const exchangeResponse = await plaidClient.itemPublicTokenExchange({
        public_token: args.publicToken,
      });

      const accessToken = exchangeResponse.data.access_token;
      const itemId = exchangeResponse.data.item_id;

      // Get full account details from Plaid
      let plaidAccounts;
      let item;
      try {
        const accountsResponse = await plaidClient.accountsGet({
          access_token: accessToken,
        });
        plaidAccounts = accountsResponse.data.accounts;
        item = accountsResponse.data.item;
      } catch (error: unknown) {
        // If we can't get account details, remove the item
        console.error('Failed to get account details:', getSafePlaidErrorDetails(error));
        try {
          await plaidClient.itemRemove({ access_token: accessToken });
        } catch (removeError: unknown) {
          console.error('Failed to remove item during cleanup:', getSafePlaidErrorDetails(removeError));
        }
        throw new ConvexError('Failed to retrieve account details from Plaid');
      }

      // Get institution details
      let institutionData;
      try {
        const institutionResponse = await plaidClient.institutionsGetById({
          institution_id: item.institution_id ?? args.institutionId,
          country_codes: [CountryCode.Us, CountryCode.Ca],
          options: {
            include_optional_metadata: true,
          },
        });
        institutionData = institutionResponse.data.institution;
      } catch (error: unknown) {
        console.error('Failed to get institution details:', getSafePlaidErrorDetails(error));
        // Use provided institution data as fallback
        institutionData = {
          institution_id: args.institutionId,
          name: args.institutionName,
          logo: null,
          primary_color: null,
        };
      }

      // Convert base64 logo to file URL if logo exists
      let logoUrl: string | undefined;

      if (institutionData.logo) {
        try {
          // Extract MIME type from data URL
          const mimeTypeMatch = institutionData.logo.match(/^data:(image\/\w+);base64,/);
          const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';

          // Clean and validate base64 string
          const base64Data = cleanBase64String(institutionData.logo);
          if (!base64Data) {
            console.warn(
              `Invalid or truncated base64 logo for ${institutionData.institution_id}, skipping logo storage`
            );
          } else {
            // Convert base64 to binary
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            // Create blob and store in Convex storage
            const blob = new Blob([bytes], { type: mimeType });
            const storageId = await ctx.storage.store(blob);

            // Get the storage URL
            logoUrl = (await ctx.storage.getUrl(storageId)) ?? undefined;
          }
        } catch (error: unknown) {
          console.error(`Failed to store institution logo for ${institutionData.institution_id}:`, error);
          // Continue without logo if storage fails
        }
      }

      // Store or get global institution
      const globalInstitutionId = await ctx.runMutation(
        // biome-ignore lint/suspicious/noExplicitAny: Plaid does not export the generic SDK response shape.
        internal.internal.institutions.upsertInstitution as any,
        {
          providerInstitutionId: institutionData.institution_id,
          provider: 'Plaid',
          name: institutionData.name,
          logoUrl,
          primaryColor: institutionData.primary_color ?? undefined,
        }
      );

      const accountsToCreate = plaidAccounts.map((plaidAccount) => {
        // Plaid sends debt (credit cards, loans) as positive numbers
        // We need to flip the sign for credit and loan accounts to represent them as negative
        const isDebtAccount = plaidAccount.type === 'credit' || plaidAccount.type === 'loan';
        const balanceMultiplier = isDebtAccount ? -1 : 1;

        // Convert to cents and flip sign for debt accounts
        const currentBalanceInCents = Math.floor((plaidAccount.balances.current ?? 0) * 100) * balanceMultiplier;
        const availableBalanceInCents = plaidAccount.balances.available
          ? Math.floor(plaidAccount.balances.available * 100) * balanceMultiplier
          : undefined;
        // Map Plaid account type to our schema
        return {
          accountNumberMask: plaidAccount.mask ?? undefined,
          accountType: mapPlaidAccountType(plaidAccount.type, plaidAccount.subtype),
          availableBalance: availableBalanceInCents,
          initialBalance: currentBalanceInCents,
          name: plaidAccount.name,
          officialName: plaidAccount.official_name ?? undefined,
          plaidAccountId: plaidAccount.account_id,
        };
      });

      const finalized = await ctx.runMutation(
        internal.bankProviders.plaid.linkNewPlaidItem.finalizePlaidBankConnection,
        {
          workspaceId: args.workspaceId,
          accessToken,
          globalInstitutionId,
          itemId,
          ownerId: identity.subject,
          initialBalanceDate: args.initialBalanceDate,
          accounts: accountsToCreate,
          attribution: {
            clerkId: identity.subject,
            source: { type: 'kualia_ui' },
          },
        }
      );

      const accountResults = plaidAccounts.map((plaidAccount, index) => ({
        bankLinkAccountId: finalized.accountIds[index],
        name: plaidAccount.name,
        mask: plaidAccount.mask,
      }));

      return {
        success: true,
        bankLinkId: finalized.bankLinkId,
        globalInstitutionId,
        accountsLinked: accountResults.length,
        accounts: accountResults,
      };
    } catch (error: unknown) {
      console.error('Error linking Plaid item:', getSafePlaidErrorDetails(error));

      // Re-throw ConvexError as-is (already user-friendly)
      if (error instanceof ConvexError) {
        throw error;
      }

      // Wrap all other errors with generic message (don't expose internals)
      throw new ConvexError(
        'Unable to connect your bank account. Please try again or contact support if the issue persists.'
      );
    }
  },
});

/**
 * Map Plaid account types to our internal schema
 */
function mapPlaidAccountType(
  type: string | null,
  subtype: string | null
):
  | 'banking_checking'
  | 'banking_savings'
  | 'banking_cash'
  | 'banking_cash_management'
  | 'banking_money_market'
  | 'banking_cd'
  | 'banking_other'
  | 'credit_credit_card'
  | 'credit_line_of_credit'
  | 'credit_other'
  | 'investment_brokerage'
  | 'investment_401k'
  | 'investment_ira'
  | 'investment_keogh'
  | 'investment_roth_ira'
  | 'investment_roth_401k'
  | 'investment_hsa'
  | 'investment_sep_ira'
  | 'investment_simple_ira'
  | 'investment_529_plan'
  | 'investment_403b'
  | 'investment_other'
  | 'loan_auto'
  | 'loan_business'
  | 'loan_commercial'
  | 'loan_construction'
  | 'loan_home_equity'
  | 'loan_mortgage'
  | 'loan_student'
  | 'loan_other' {
  // Map Plaid account type and subtype to our schema
  if (type === 'depository') {
    if (subtype === 'checking') return 'banking_checking';
    if (subtype === 'savings') return 'banking_savings';
    if (subtype === 'cd') return 'banking_cd';
    if (subtype === 'money market') return 'banking_money_market';
    if (subtype === 'cash management') return 'banking_cash_management';
    return 'banking_other';
  }
  if (type === 'credit') {
    if (subtype === 'credit card') return 'credit_credit_card';
    if (subtype === 'paypal') return 'credit_credit_card'; // PayPal is treated as credit card
    return 'credit_other';
  }
  if (type === 'loan') {
    if (subtype === 'auto') return 'loan_auto';
    if (subtype === 'business') return 'loan_business';
    if (subtype === 'commercial') return 'loan_commercial';
    if (subtype === 'construction') return 'loan_construction';
    if (subtype === 'consumer') return 'loan_other';
    if (subtype === 'home equity') return 'loan_home_equity';
    if (subtype === 'line of credit') return 'credit_line_of_credit';
    if (subtype === 'loan') return 'loan_other';
    if (subtype === 'mortgage') return 'loan_mortgage';
    if (subtype === 'overdraft') return 'loan_other';
    if (subtype === 'student') return 'loan_student';
    return 'loan_other';
  }
  if (type === 'investment') {
    if (subtype === '401k') return 'investment_401k';
    if (subtype === '403b') return 'investment_403b';
    if (subtype === '529') return 'investment_529_plan';
    if (subtype === 'brokerage') return 'investment_brokerage';
    if (subtype === 'hsa') return 'investment_hsa';
    if (subtype === 'ira') return 'investment_ira';
    if (subtype === 'keogh') return 'investment_keogh';
    if (subtype === 'roth') return 'investment_roth_ira';
    if (subtype === 'roth 401k') return 'investment_roth_401k';
    if (subtype === 'sep ira') return 'investment_sep_ira';
    if (subtype === 'simple ira') return 'investment_simple_ira';
    return 'investment_other';
  }
  return 'banking_other'; // Default fallback
}
