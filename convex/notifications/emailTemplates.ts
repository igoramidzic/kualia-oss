/**
 * Email template configuration for transactional emails
 * HTML templates are defined here for email notifications
 */

/**
 * Format currency amount from bigint (cents) to USD string
 */
function formatCurrency(amount: bigint): string {
  const amountInDollars = Number(amount) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amountInDollars);
}

export type UpcomingTransaction = {
  merchantName: string | null;
  amount: bigint;
  nextDueDate: string;
};

export type DashboardMetrics = {
  monthlyProfitLoss: bigint;
  monthlyRecurringExpenses: bigint;
  currentMonthRevenue: bigint;
};

/**
 * HTML email template for daily digest notifications
 * Realistic placeholder template to avoid spam filters
 */
export const DAILY_DIGEST_HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Daily Kualia Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid #e5e5e5;">
              <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 600;">Hello, Welcome to Kualia</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px;">
                Thank you for using Kualia to manage your finances. We're here to help you stay on top of your financial health.
              </p>
              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px;">
                This is your daily digest with important updates and insights about your financial status.
              </p>
              <p style="margin: 0; color: #666666; font-size: 14px;">
                Stay tuned for more detailed information and personalized recommendations coming soon.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9f9f9; border-top: 1px solid #e5e5e5; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #666666; font-size: 12px;">
                © 2025 Kualia. All rights reserved.
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px;">
                You're receiving this email because you're a member of a Kualia workspace.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();

/**
 * Default subject line for daily digest emails
 */
export const DAILY_DIGEST_SUBJECT = 'Your Daily Kualia Update';

/**
 * Email template configuration for daily digest
 */
export const DAILY_NOTIFICATION_TEMPLATE = {
  subject: DAILY_DIGEST_SUBJECT,
  html: DAILY_DIGEST_HTML_TEMPLATE,
};

/**
 * Generate HTML email template for daily digest with transactions and metrics
 */
export function generateDailyDigestTemplate(
  workspaceName: string,
  overdueTransactions: UpcomingTransaction[],
  dueTodayTransactions: UpcomingTransaction[],
  dueTomorrowTransactions: UpcomingTransaction[],
  metrics: DashboardMetrics
): string {
  const formatTransactionList = (transactions: UpcomingTransaction[]): string => {
    if (transactions.length === 0) {
      return '<p style="margin: 0; color: #666666; font-size: 14px;">No transactions due.</p>';
    }

    return `
      <ul style="margin: 0; padding-left: 20px; color: #333333; font-size: 16px;">
        ${transactions
          .map(
            (tx) =>
              `<li style="margin-bottom: 8px;">
                <strong>${tx.merchantName ?? 'Unknown Merchant'}</strong> - ${formatCurrency(tx.amount)}
              </li>`
          )
          .join('')}
      </ul>
    `;
  };

  const profitLossColor = metrics.monthlyProfitLoss >= 0n ? '#10b981' : '#ef4444';
  const profitLossSign = metrics.monthlyProfitLoss >= 0n ? '+' : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Your Daily Kualia Update</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid #e5e5e5;">
              <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 600;">Your Daily Kualia Update</h1>
              <p style="margin: 10px 0 0 0; color: #666666; font-size: 16px;">${workspaceName}</p>
            </td>
          </tr>

          <!-- Dashboard Metrics -->
          <tr>
            <td style="padding: 40px 40px 20px 40px;">
              <h2 style="margin: 0 0 20px 0; color: #1a1a1a; font-size: 20px; font-weight: 600;">Financial Overview</h2>
              <table role="presentation" style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">
                    <span style="color: #666666; font-size: 14px;">Monthly Profit/Loss</span>
                    <div style="color: ${profitLossColor}; font-size: 24px; font-weight: 600; margin-top: 4px;">
                      ${profitLossSign}${formatCurrency(metrics.monthlyProfitLoss)}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0; border-bottom: 1px solid #e5e5e5;">
                    <span style="color: #666666; font-size: 14px;">Monthly Recurring Expenses</span>
                    <div style="color: #1a1a1a; font-size: 24px; font-weight: 600; margin-top: 4px;">
                      ${formatCurrency(metrics.monthlyRecurringExpenses)}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px 0;">
                    <span style="color: #666666; font-size: 14px;">Current Month Revenue</span>
                    <div style="color: #1a1a1a; font-size: 24px; font-weight: 600; margin-top: 4px;">
                      ${formatCurrency(metrics.currentMonthRevenue)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Overdue Transactions -->
          ${
            overdueTransactions.length > 0
              ? `
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 15px 0; color: #ef4444; font-size: 18px; font-weight: 600;">⚠️ Overdue</h2>
              ${formatTransactionList(overdueTransactions)}
            </td>
          </tr>
          `
              : ''
          }

          <!-- Transactions Due Today -->
          <tr>
            <td style="padding: 20px 40px;">
              <h2 style="margin: 0 0 15px 0; color: #1a1a1a; font-size: 18px; font-weight: 600;">Due Today</h2>
              ${formatTransactionList(dueTodayTransactions)}
            </td>
          </tr>

          <!-- Transactions Due Tomorrow -->
          <tr>
            <td style="padding: 20px 40px 40px 40px;">
              <h2 style="margin: 0 0 15px 0; color: #1a1a1a; font-size: 18px; font-weight: 600;">Due Tomorrow</h2>
              ${formatTransactionList(dueTomorrowTransactions)}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9f9f9; border-top: 1px solid #e5e5e5; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #666666; font-size: 12px;">
                © 2025 Kualia. All rights reserved.
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px;">
                You're receiving this email because you're a member of a Kualia workspace.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Generate HTML email template for bank link status change notifications
 */
export function getBankLinkStatusChangeTemplate(
  institutionName: string,
  status: 'Error' | 'Pending' | 'Disconnected',
  workspaceShortId: string
): string {
  const statusMessages: Record<
    'Error' | 'Pending' | 'Disconnected',
    { title: string; description: string; color: string }
  > = {
    Error: {
      title: 'Connection Error',
      description:
        'There was an error connecting to your bank account. Please reconnect your bank account to restore automatic transaction syncing.',
      color: '#ef4444',
    },
    Pending: {
      title: 'Connection Expiring Soon',
      description:
        'Your bank connection is about to expire. Please reconnect your bank account to avoid interruptions in transaction syncing.',
      color: '#f59e0b',
    },
    Disconnected: {
      title: 'Bank Connection Disconnected',
      description:
        'Your bank connection has been disconnected. Please reconnect your bank account to restore automatic transaction syncing.',
      color: '#6b7280',
    },
  };

  const statusInfo = statusMessages[status];
  const settingsUrl = `https://kualia.com/${workspaceShortId}/settings/bank-connections`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Bank Connection ${statusInfo.title}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5; line-height: 1.6;">
  <table role="presentation" style="width: 100%; border-collapse: collapse; background-color: #f5f5f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px 40px; text-align: center; border-bottom: 1px solid #e5e5e5;">
              <h1 style="margin: 0; color: #1a1a1a; font-size: 28px; font-weight: 600;">${statusInfo.title}</h1>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="display: inline-block; width: 60px; height: 60px; border-radius: 50%; background-color: ${statusInfo.color}20; display: flex; align-items: center; justify-content: center;">
                  <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${statusInfo.color};"></div>
                </div>
              </div>

              <p style="margin: 0 0 20px 0; color: #333333; font-size: 16px; text-align: center; font-weight: 600;">
                ${institutionName}
              </p>

              <p style="margin: 0 0 30px 0; color: #333333; font-size: 16px;">
                ${statusInfo.description}
              </p>

              <div style="text-align: center; margin: 30px 0;">
                <a href="${settingsUrl}" style="display: inline-block; padding: 12px 24px; background-color: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
                  Reconnect Bank Account
                </a>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f9f9f9; border-top: 1px solid #e5e5e5; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #666666; font-size: 12px;">
                © 2025 Kualia. All rights reserved.
              </p>
              <p style="margin: 0; color: #999999; font-size: 12px;">
                You're receiving this email because you're a member of a Kualia workspace.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`.trim();
}

/**
 * Generate subject line for bank link status change notifications
 */
export function getBankLinkStatusChangeSubject(
  institutionName: string,
  status: 'Error' | 'Pending' | 'Disconnected'
): string {
  const statusTitles: Record<'Error' | 'Pending' | 'Disconnected', string> = {
    Error: 'Connection Error',
    Pending: 'Connection Expiring Soon',
    Disconnected: 'Connection Disconnected',
  };

  return `${institutionName} - ${statusTitles[status]}`;
}
