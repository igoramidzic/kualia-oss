/**
 * Arithmetic Expression Evaluator
 *
 * Parses and evaluates free-form arithmetic expressions.
 * Supports +, -, *, / with standard math precedence.
 */

/**
 * Tokenizer - converts expression string into tokens
 */
type TokenType = 'number' | 'operator' | 'lparen' | 'rparen';

interface Token {
  type: TokenType;
  value: string | number;
}

function tokenize(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const char = expr[i];

    // Skip whitespace
    if (/\s/.test(char)) {
      i++;
      continue;
    }

    // Number (including decimals)
    if (/[\d.]/.test(char)) {
      let numStr = '';
      let hasDecimal = false;

      while (i < expr.length && /[\d.]/.test(expr[i])) {
        if (expr[i] === '.') {
          if (hasDecimal) return null; // Multiple decimals
          hasDecimal = true;
        }
        numStr += expr[i];
        i++;
      }

      // Invalid number patterns
      if (numStr === '.' || numStr.startsWith('.') || numStr.endsWith('.')) {
        // Allow leading decimal like ".5"
        if (numStr.startsWith('.') && numStr.length > 1 && numStr !== '.') {
          // Valid: .5
        } else if (numStr.endsWith('.') && numStr.length > 1) {
          // Allow trailing decimal like "5."
        } else if (numStr === '.') {
          return null;
        }
      }

      const num = parseFloat(numStr);
      if (isNaN(num)) return null;

      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Operators
    if (['+', '-', '*', '/'].includes(char)) {
      tokens.push({ type: 'operator', value: char });
      i++;
      continue;
    }

    // Parentheses
    if (char === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
      continue;
    }

    if (char === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
      continue;
    }

    // Invalid character
    return null;
  }

  return tokens;
}

/**
 * Recursive descent parser with operator precedence
 * Grammar:
 *   expr    -> term (('+' | '-') term)*
 *   term    -> factor (('*' | '/') factor)*
 *   factor  -> number | '(' expr ')' | '-' factor
 */
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  parse(): number | null {
    if (this.tokens.length === 0) return null;

    try {
      const result = this.expr();
      if (this.pos !== this.tokens.length) {
        return null; // Unconsumed tokens
      }
      return result;
    } catch {
      return null;
    }
  }

  private expr(): number {
    let left = this.term();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type !== 'operator' || (token.value !== '+' && token.value !== '-')) {
        break;
      }

      this.pos++;
      const right = this.term();

      if (token.value === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  private term(): number {
    let left = this.factor();

    while (this.pos < this.tokens.length) {
      const token = this.tokens[this.pos];
      if (token.type !== 'operator' || (token.value !== '*' && token.value !== '/')) {
        break;
      }

      this.pos++;
      const right = this.factor();

      if (token.value === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      }
    }

    return left;
  }

  private factor(): number {
    const token = this.tokens[this.pos];

    if (!token) {
      throw new Error('Unexpected end of expression');
    }

    // Unary minus
    if (token.type === 'operator' && token.value === '-') {
      this.pos++;
      return -this.factor();
    }

    // Unary plus (just skip it)
    if (token.type === 'operator' && token.value === '+') {
      this.pos++;
      return this.factor();
    }

    // Number
    if (token.type === 'number') {
      this.pos++;
      return token.value as number;
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.pos++;
      const result = this.expr();

      if (this.pos >= this.tokens.length || this.tokens[this.pos].type !== 'rparen') {
        throw new Error('Missing closing parenthesis');
      }

      this.pos++;
      return result;
    }

    throw new Error(`Unexpected token: ${JSON.stringify(token)}`);
  }
}

/**
 * Parse and evaluate a simple arithmetic expression.
 * Supports +, -, *, / with standard math precedence and parentheses.
 * Returns null if expression is invalid.
 *
 * @param expr - The arithmetic expression to evaluate (e.g., "100+50", "100 + 50 * 2")
 * @param decimalPlaces - Number of decimal places for the currency (e.g., 2 for USD)
 * @returns The result in cents (smallest currency unit), or null if invalid
 */
export function evaluateExpression(expr: string, decimalPlaces: number): number | null {
  // Empty input is invalid
  if (!expr || expr.trim() === '') {
    return null;
  }

  // Tokenize
  const tokens = tokenize(expr);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  // Check for invalid patterns:
  // - Trailing operator (except in parentheses context which parser handles)
  const lastToken = tokens[tokens.length - 1];
  if (lastToken.type === 'operator') {
    return null;
  }

  // Parse and evaluate
  const parser = new Parser(tokens);
  const result = parser.parse();

  if (result === null || !isFinite(result)) {
    return null;
  }

  // Convert to cents (smallest currency unit)
  const multiplier = Math.pow(10, decimalPlaces);
  return Math.round(result * multiplier);
}

/**
 * Format a value in cents to a display string suitable for an editable input.
 * Does not include thousand separators so the value can be re-parsed by evaluateExpression.
 *
 * @param cents - The value in cents
 * @param decimalPlaces - Number of decimal places for the currency
 * @returns Formatted string (e.g., "100.00" for 10000 cents with 2 decimal places)
 */
export function formatCentsForDisplay(cents: number, decimalPlaces: number): string {
  const divisor = Math.pow(10, decimalPlaces);
  const value = cents / divisor;

  return value.toFixed(decimalPlaces);
}
