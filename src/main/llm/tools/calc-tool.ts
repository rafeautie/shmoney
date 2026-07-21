import type { CalcToolResult } from '@shared/chat'

// Pure helper behind the chat `calc` tool: a small arithmetic evaluator the
// model calls instead of doing sums in its head. Like sql-tool.ts and
// chart-tool.ts, this module stays free of any Electron-bound import so vitest
// can load it. It never touches the database; the model puts literal numbers
// (usually read straight off a query result) into the expression.
//
// The grammar is the smallest that covers the arithmetic a finance answer
// actually needs — percentages, ratios, differences, compound growth:
//   expr  := term (('+' | '-') term)*
//   term  := power (('*' | '/') power)*
//   power := unary ('**' power)?        // right-associative
//   unary := ('+' | '-') unary | atom
//   atom  := number | '(' expr ')'
// No named functions and no variables on purpose: a bare calculator has nothing
// for a small model to misread or invent, and the numbers it needs are always
// already in front of it.

/**
 * Params schema for defineChatSessionFunction. The one property is generated
 * (the grammar treats it as required); its description is the model's main
 * documentation. No column name appears here — the model pastes numbers, not
 * names, so nothing should read as a name to copy.
 */
export const CALC_FUNCTION_PARAMS = {
  type: 'object',
  properties: {
    expression: {
      type: 'string',
      description:
        'One arithmetic expression over plain numbers, e.g. "1234.56 / 5000 * 100". Uses + - * / ** and parentheses; no column names, units or currency symbols, just the numbers you have.'
    }
  }
} as const

/** a lexed piece of an expression */
type Token =
  | { kind: 'num'; value: number }
  | { kind: 'op'; value: string }
  | { kind: 'paren'; value: '(' | ')' }

/** a parse-time failure, phrased for the model; caught at the top of evaluate */
class CalcError extends Error {}

const MALFORMED =
  'The expression contains something I cannot evaluate; use only numbers and + - * / ** ( ).'

/** Split the input into tokens, or null if a character has no place in the grammar. */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
    } else if (c === '(' || c === ')') {
      tokens.push({ kind: 'paren', value: c })
      i++
    } else if (c === '*' && input[i + 1] === '*') {
      tokens.push({ kind: 'op', value: '**' })
      i += 2
    } else if (c === '+' || c === '-' || c === '*' || c === '/') {
      tokens.push({ kind: 'op', value: c })
      i++
    } else if ((c >= '0' && c <= '9') || c === '.') {
      let j = i
      while (j < input.length && ((input[j] >= '0' && input[j] <= '9') || input[j] === '.')) j++
      const text = input.slice(i, j)
      // one dot at most, and it must parse: rejects "1.2.3" and a lone "."
      const value = (text.match(/\./g)?.length ?? 0) > 1 ? NaN : Number(text)
      if (!Number.isFinite(value)) return null
      tokens.push({ kind: 'num', value })
      i = j
    } else {
      return null
    }
  }
  return tokens
}

/**
 * Evaluate one arithmetic expression. Never throws: every failure — a bad
 * character, a syntax error, division by zero — comes back as an { ok: false }
 * result the model can read and correct. The finite value is cleaned to 12
 * significant figures so IEEE dust (0.1 + 0.2 = 0.30000000000000004) never
 * reaches the answer.
 */
export function evaluateExpression(expression: string): CalcToolResult {
  const tokens = tokenize(expression)
  if (tokens === null) return { ok: false, error: MALFORMED }
  if (tokens.length === 0) return { ok: false, error: 'The expression is empty.' }

  let pos = 0
  const peek = (): Token | undefined => tokens[pos]

  const parseExpr = (): number => {
    let left = parseTerm()
    for (let t = peek(); t?.kind === 'op' && (t.value === '+' || t.value === '-'); t = peek()) {
      pos++
      const right = parseTerm()
      left = t.value === '+' ? left + right : left - right
    }
    return left
  }
  const parseTerm = (): number => {
    let left = parsePower()
    for (let t = peek(); t?.kind === 'op' && (t.value === '*' || t.value === '/'); t = peek()) {
      pos++
      const right = parsePower()
      left = t.value === '*' ? left * right : left / right
    }
    return left
  }
  const parsePower = (): number => {
    const base = parseUnary()
    const t = peek()
    if (t?.kind === 'op' && t.value === '**') {
      pos++
      return base ** parsePower() // right-associative: 2 ** 3 ** 2 = 512
    }
    return base
  }
  const parseUnary = (): number => {
    const t = peek()
    if (t?.kind === 'op' && (t.value === '+' || t.value === '-')) {
      pos++
      const v = parseUnary()
      return t.value === '-' ? -v : v
    }
    return parseAtom()
  }
  const parseAtom = (): number => {
    const t = peek()
    if (t?.kind === 'num') {
      pos++
      return t.value
    }
    if (t?.kind === 'paren' && t.value === '(') {
      pos++
      const v = parseExpr()
      const close = peek()
      if (close?.kind === 'paren' && close.value === ')') {
        pos++
        return v
      }
      throw new CalcError('A "(" is missing its closing ")".')
    }
    throw new CalcError(MALFORMED)
  }

  try {
    const value = parseExpr()
    if (pos !== tokens.length) throw new CalcError(MALFORMED)
    if (!Number.isFinite(value))
      return { ok: false, error: 'The result is not a finite number (a division by zero?).' }
    return { ok: true, value: Number(value.toPrecision(12)) }
  } catch (err) {
    if (err instanceof CalcError) return { ok: false, error: err.message }
    throw err
  }
}
