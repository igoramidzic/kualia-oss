/**
 * Unit tests for arithmetic expression evaluator
 * Tests free-form expression parsing for budget assignment input
 */
import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatCentsForDisplay } from './arithmetic-input-state';

describe('evaluateExpression', () => {
  describe('basic numbers', () => {
    it('should parse simple integers', () => {
      expect(evaluateExpression('100', 2)).toBe(10000); // 100.00 in cents
      expect(evaluateExpression('1', 2)).toBe(100);
      expect(evaluateExpression('0', 2)).toBe(0);
    });

    it('should parse decimal numbers', () => {
      expect(evaluateExpression('100.50', 2)).toBe(10050);
      expect(evaluateExpression('25.25', 2)).toBe(2525);
      expect(evaluateExpression('0.99', 2)).toBe(99);
    });

    it('should handle whitespace', () => {
      expect(evaluateExpression('  100  ', 2)).toBe(10000);
      expect(evaluateExpression(' 50.50 ', 2)).toBe(5050);
    });
  });

  describe('addition', () => {
    it('should evaluate simple addition', () => {
      expect(evaluateExpression('100+50', 2)).toBe(15000); // 150.00 in cents
    });

    it('should evaluate addition with spaces', () => {
      expect(evaluateExpression('100 + 50', 2)).toBe(15000);
    });

    it('should evaluate multi-operand addition', () => {
      expect(evaluateExpression('100+50+25', 2)).toBe(17500); // 175.00 in cents
      expect(evaluateExpression('100 + 50 + 25 + 10', 2)).toBe(18500);
    });

    it('should evaluate addition with decimals', () => {
      expect(evaluateExpression('100.50+25.25', 2)).toBe(12575); // 125.75 in cents
    });
  });

  describe('subtraction', () => {
    it('should evaluate simple subtraction', () => {
      expect(evaluateExpression('100-30', 2)).toBe(7000); // 70.00 in cents
    });

    it('should evaluate subtraction with spaces', () => {
      expect(evaluateExpression('100 - 30', 2)).toBe(7000);
    });

    it('should evaluate multi-operand subtraction', () => {
      expect(evaluateExpression('100-30-20', 2)).toBe(5000); // 50.00 in cents
    });

    it('should handle negative results', () => {
      expect(evaluateExpression('30-50', 2)).toBe(-2000); // -20.00 in cents
    });

    it('should allow leading negative numbers', () => {
      expect(evaluateExpression('-50', 2)).toBe(-5000); // -50.00 in cents
      expect(evaluateExpression('-50+100', 2)).toBe(5000); // 50.00 in cents
    });
  });

  describe('multiplication', () => {
    it('should evaluate simple multiplication', () => {
      expect(evaluateExpression('100*2', 2)).toBe(20000); // 200.00 in cents
    });

    it('should evaluate multiplication with spaces', () => {
      expect(evaluateExpression('100 * 2', 2)).toBe(20000);
    });

    it('should evaluate decimal multiplication', () => {
      expect(evaluateExpression('50*1.5', 2)).toBe(7500); // 75.00 in cents
    });
  });

  describe('division', () => {
    it('should evaluate simple division', () => {
      expect(evaluateExpression('100/4', 2)).toBe(2500); // 25.00 in cents
    });

    it('should evaluate division with spaces', () => {
      expect(evaluateExpression('100 / 4', 2)).toBe(2500);
    });

    it('should round division results', () => {
      expect(evaluateExpression('100/3', 2)).toBe(3333); // 33.33 in cents (rounded)
    });

    it('should return null for division by zero', () => {
      expect(evaluateExpression('100/0', 2)).toBeNull();
    });
  });

  describe('operator precedence', () => {
    it('should respect multiplication over addition', () => {
      expect(evaluateExpression('100+50*2', 2)).toBe(20000); // 100 + (50*2) = 200.00 in cents
    });

    it('should respect division over subtraction', () => {
      expect(evaluateExpression('100-50/2', 2)).toBe(7500); // 100 - (50/2) = 75.00 in cents
    });

    it('should handle mixed precedence', () => {
      expect(evaluateExpression('10+20*3-5', 2)).toBe(6500); // 10 + 60 - 5 = 65.00 in cents
    });
  });

  describe('parentheses', () => {
    it('should respect parentheses over precedence', () => {
      expect(evaluateExpression('(100+50)*2', 2)).toBe(30000); // 300.00 in cents
    });

    it('should handle nested parentheses', () => {
      expect(evaluateExpression('((10+20)*2)+5', 2)).toBe(6500); // 65.00 in cents
    });

    it('should handle complex parentheses', () => {
      expect(evaluateExpression('(100-50)/(2+3)', 2)).toBe(1000); // 10.00 in cents
    });
  });

  describe('mixed operations', () => {
    it('should evaluate complex expression', () => {
      expect(evaluateExpression('100-50+25', 2)).toBe(7500); // 75.00 in cents
    });

    it('should evaluate expression with all operators', () => {
      // 10 + 20 * 3 / 2 - 5 = 10 + 30 - 5 = 35
      expect(evaluateExpression('10+20*3/2-5', 2)).toBe(3500);
    });
  });

  describe('invalid expressions', () => {
    it('should return null for empty string', () => {
      expect(evaluateExpression('', 2)).toBeNull();
    });

    it('should return null for whitespace only', () => {
      expect(evaluateExpression('   ', 2)).toBeNull();
    });

    it('should return null for letters', () => {
      expect(evaluateExpression('abc', 2)).toBeNull();
      expect(evaluateExpression('100abc', 2)).toBeNull();
      expect(evaluateExpression('abc100', 2)).toBeNull();
    });

    it('should return null for trailing operator', () => {
      expect(evaluateExpression('100+', 2)).toBeNull();
      expect(evaluateExpression('100-', 2)).toBeNull();
      expect(evaluateExpression('100*', 2)).toBeNull();
      expect(evaluateExpression('100/', 2)).toBeNull();
    });

    it('should return null for leading multiply/divide', () => {
      // Unary + is valid, so +50 evaluates to 50
      expect(evaluateExpression('+50', 2)).toBe(5000);
      // But * and / at the start are invalid
      expect(evaluateExpression('*50', 2)).toBeNull();
      expect(evaluateExpression('/50', 2)).toBeNull();
    });

    it('should handle consecutive operators with unary +/-', () => {
      // These are valid: 100 + (+50) and 100 + (-50)
      expect(evaluateExpression('100++50', 2)).toBe(15000); // 100 + (+50) = 150
      expect(evaluateExpression('100+-50', 2)).toBe(5000); // 100 + (-50) = 50
      // But these are invalid: can't have */ followed by * or /
      expect(evaluateExpression('100*/50', 2)).toBeNull();
      expect(evaluateExpression('100/*50', 2)).toBeNull();
    });

    it('should return null for multiple decimal points', () => {
      expect(evaluateExpression('100.50.25', 2)).toBeNull();
    });

    it('should return null for mismatched parentheses', () => {
      expect(evaluateExpression('(100+50', 2)).toBeNull();
      expect(evaluateExpression('100+50)', 2)).toBeNull();
      expect(evaluateExpression('((100+50)', 2)).toBeNull();
    });

    it('should return null for special characters', () => {
      expect(evaluateExpression('100$50', 2)).toBeNull();
      expect(evaluateExpression('100%50', 2)).toBeNull();
      expect(evaluateExpression('$100', 2)).toBeNull();
    });
  });

  describe('currencies with different decimal places', () => {
    it('should handle JPY (0 decimal places)', () => {
      expect(evaluateExpression('1000', 0)).toBe(1000);
      expect(evaluateExpression('1000+500', 0)).toBe(1500);
    });

    it('should handle KWD (3 decimal places)', () => {
      expect(evaluateExpression('1.000', 3)).toBe(1000); // 1.000 in millimes
      expect(evaluateExpression('100.500', 3)).toBe(100500);
    });
  });

  describe('edge cases', () => {
    it('should handle very small decimals', () => {
      expect(evaluateExpression('0.01', 2)).toBe(1);
      expect(evaluateExpression('0.01+0.01', 2)).toBe(2);
    });

    it('should handle large numbers', () => {
      expect(evaluateExpression('999999.99', 2)).toBe(99999999);
      expect(evaluateExpression('1000000+1000000', 2)).toBe(200000000);
    });

    it('should round decimal results correctly', () => {
      // 10/3 = 3.333... should round to 3.33 (333 cents)
      expect(evaluateExpression('10/3', 2)).toBe(333);
      // 1/3 = 0.333... should round to 0.33 (33 cents)
      expect(evaluateExpression('1/3', 2)).toBe(33);
    });
  });
});

describe('formatCentsForDisplay', () => {
  it('should format cents to display string with 2 decimal places', () => {
    expect(formatCentsForDisplay(10000, 2)).toBe('100.00');
    expect(formatCentsForDisplay(15050, 2)).toBe('150.50');
    expect(formatCentsForDisplay(99, 2)).toBe('0.99');
    expect(formatCentsForDisplay(0, 2)).toBe('0.00');
  });

  it('should format large values without thousand separators (so the value can be re-parsed)', () => {
    expect(formatCentsForDisplay(100000000, 2)).toBe('1000000.00');
    expect(formatCentsForDisplay(123456789, 2)).toBe('1234567.89');
  });

  it('should format JPY (0 decimal places)', () => {
    expect(formatCentsForDisplay(1000, 0)).toBe('1000');
    expect(formatCentsForDisplay(100, 0)).toBe('100');
  });

  it('should format KWD (3 decimal places)', () => {
    expect(formatCentsForDisplay(1000, 3)).toBe('1.000');
    expect(formatCentsForDisplay(100500, 3)).toBe('100.500');
  });

  it('should handle negative values', () => {
    expect(formatCentsForDisplay(-5000, 2)).toBe('-50.00');
    expect(formatCentsForDisplay(-100, 2)).toBe('-1.00');
  });
});
