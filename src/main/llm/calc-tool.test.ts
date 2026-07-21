import { describe, it, expect } from 'vitest'
import { evaluateExpression } from './calc-tool'

describe('evaluateExpression', () => {
  it.each([
    ['2 + 3', 5],
    ['2 + 3 * 4', 14], // precedence: * before +
    ['(2 + 3) * 4', 20], // parentheses override it
    ['10 / 4', 2.5],
    ['7 - 2 - 1', 4], // left-associative subtraction
    ['-5 + 2', -3], // unary minus
    ['- -5', 5], // stacked unary
    ['2 ** 3', 8],
    ['2 ** 3 ** 2', 512] // ** is right-associative: 2 ** (3 ** 2)
  ])('evaluates %s to %s', (expr, expected) => {
    expect(evaluateExpression(expr)).toEqual({ ok: true, value: expected })
  })

  it('cleans IEEE floating-point dust off the result', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in raw double arithmetic
    expect(evaluateExpression('0.1 + 0.2')).toEqual({ ok: true, value: 0.3 })
  })

  it.each([
    ['1234.56 / 5000 * 100', 24.6912], // a "what percent of income" call
    ['59.84 / 500 * 100', 11.968],
    ['1.05 ** 2', 1.1025] // compound growth
  ])('evaluates the finance-shaped call %s to about %s', (expr, expected) => {
    const result = evaluateExpression(expr)
    expect(result.ok).toBe(true)
    expect(result.value).toBeCloseTo(expected, 10)
  })

  it.each([
    ['1 / 0', 'not a finite number'], // division by zero is Infinity, not a number to state
    ['', 'empty'],
    ['2 +', undefined], // dangling operator
    ['1 2', undefined], // two numbers, no operator: leftover text
    ['(1 + 2', 'closing'], // unbalanced parenthesis
    ['1.2.3', undefined], // malformed number
    ['SELECT 1', undefined], // not arithmetic at all
    ['3 % 2', undefined] // % is not in the grammar
  ])('rejects %s', (expr, fragment) => {
    const result = evaluateExpression(expr)
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    if (fragment) expect(result.error).toContain(fragment)
  })
})
