/**
 * Cleans and normalizes a currency input string
 * Removes invalid characters while preserving numbers, decimals, commas, and math operators
 * @param input - The raw input string
 * @returns The cleaned string
 */
export function cleanCurrencyInput(input: string): string {
  // Remove currency symbols
  let cleaned = input.replace(/[$£€¥₹₽₩฿₫₪₦₨₱₡₵₸₴₺₼₾₹]/g, '');

  // Remove letters and invalid special characters, but keep numbers, commas, periods, and math operators
  cleaned = cleaned.replace(/[^0-9,.\-+*/\s]/g, '');

  // Handle multiple decimal points only in simple numbers (not expressions)
  // Check if it's likely an expression (has operators other than leading minus)
  const hasOperators = /[+*/]/.test(cleaned) || /\d\s*-\s*\d/.test(cleaned);

  if (!hasOperators) {
    // For simple numbers, keep only the first decimal point
    const parts = cleaned.split('.');
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('');
    }
  }

  // Trim spaces
  return cleaned.trim();
}

/**
 * Parses a number string that may contain commas
 * @param numberStr - The number string to parse (e.g., "1,000.50")
 * @returns The parsed number or null if invalid
 */
export function parseFormattedNumber(numberStr: string): number | null {
  // Remove commas for parsing
  const withoutCommas = numberStr.replace(/,/g, '');

  // Check if it's a valid number format
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(withoutCommas)) {
    return null;
  }

  const parsed = parseFloat(withoutCommas);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Evaluates a mathematical expression string and returns the numeric result
 * Supports basic operations: +, -, *, /
 * Handles comma-formatted numbers (e.g., "1,000 + 500")
 * @param expression - The expression to evaluate (e.g., "10+5", "20.5*2", "1,000.50")
 * @returns The evaluated number or null if invalid
 */
export function evaluateAmountExpression(expression: string): number | null {
  // Clean the input first
  const cleanExpr = cleanCurrencyInput(expression);

  // Treat empty string as 0
  if (!cleanExpr) return 0;

  // Check if it's a simple number (with or without commas)
  // Don't treat a leading minus as an operator (it's a negative sign)
  const hasOperator = /[+*/]/.exec(cleanExpr) ?? /[\d,]\s*-\s*[\d,]/.exec(cleanExpr);
  if (!hasOperator) {
    return parseFormattedNumber(cleanExpr);
  }

  // Parse mathematical expression (support +, -, *, /)
  // Updated pattern to handle comma-formatted numbers
  const expressionPattern = /^(-?(?:[\d,]+(?:\.\d+)?|\.\d+))\s*([+\-*/])\s*(-?(?:[\d,]+(?:\.\d+)?|\.\d+))$/;
  const match = expressionPattern.exec(cleanExpr);

  if (!match) {
    // Check for multiple operations (not supported)
    if (/[+\-*/].*[+\-*/]/.exec(cleanExpr)) {
      return null;
    }
    return null;
  }

  const leftOperand = parseFormattedNumber(match[1]);
  const operator = match[2];
  const rightOperand = parseFormattedNumber(match[3]);

  if (leftOperand === null || rightOperand === null) {
    return null;
  }

  switch (operator) {
    case '+':
      return leftOperand + rightOperand;
    case '-':
      return leftOperand - rightOperand;
    case '*':
      return leftOperand * rightOperand;
    case '/':
      if (rightOperand === 0) {
        return null; // Division by zero
      }
      return leftOperand / rightOperand;
    default:
      return null;
  }
}
