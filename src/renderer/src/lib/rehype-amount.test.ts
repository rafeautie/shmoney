import { describe, expect, it } from 'vitest'
import { rehypeAmount, type HastNode } from './rehype-amount'

function run(tree: HastNode): HastNode {
  rehypeAmount()(tree)
  return tree
}

function textNode(value: string): HastNode {
  return { type: 'text', value }
}

function root(children: HastNode[]): HastNode {
  return { type: 'root', children }
}

function amountSpan(dataAmount: string, dataCurrency: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { dataAmount, dataCurrency },
    children: []
  }
}

describe('rehypeAmount', () => {
  it('turns a positive amount marker into a span', () => {
    const tree = run(root([textNode('{{1203123.12 USD}}')]))
    expect(tree.children).toEqual([amountSpan('1203123.12', 'USD')])
  })

  it('turns a negative amount marker into a span', () => {
    const tree = run(root([textNode('{{-45.00 USD}}')]))
    expect(tree.children).toEqual([amountSpan('-45.00', 'USD')])
  })

  it('accepts any 3 uppercase letter currency code', () => {
    const tree = run(root([textNode('{{12.34 XYZ}}')]))
    expect(tree.children).toEqual([amountSpan('12.34', 'XYZ')])
  })

  it('preserves surrounding text order in a mixed sentence', () => {
    const tree = run(root([textNode('You spent {{12.34 USD}} on coffee.')]))
    expect(tree.children).toEqual([
      textNode('You spent '),
      amountSpan('12.34', 'USD'),
      textNode(' on coffee.')
    ])
  })

  it('leaves bare numbers untouched', () => {
    const node = textNode('1203123.12')
    const tree = run(root([node]))
    expect(tree.children).toEqual([node])
    expect(tree.children?.[0]).toBe(node)
  })

  it('leaves a marker missing a currency code untouched', () => {
    const node = textNode('{{1234.56}}')
    const tree = run(root([node]))
    expect(tree.children?.[0]).toBe(node)
  })

  it('leaves a lowercase currency code untouched', () => {
    const node = textNode('{{12.34 usd}}')
    const tree = run(root([node]))
    expect(tree.children?.[0]).toBe(node)
  })

  it('skips subtrees inside a code element', () => {
    const codeText = textNode('{{12.34 USD}}')
    const tree = run(root([{ type: 'element', tagName: 'code', children: [codeText] }]))
    const codeEl = tree.children?.[0]
    expect(codeEl?.children?.[0]).toBe(codeText)
  })

  it('skips subtrees inside a pre element', () => {
    const preText = textNode('{{12.34 USD}}')
    const tree = run(root([{ type: 'element', tagName: 'pre', children: [preText] }]))
    const preEl = tree.children?.[0]
    expect(preEl?.children?.[0]).toBe(preText)
  })

  it('skips subtrees inside an anchor element', () => {
    const aText = textNode('{{12.34 USD}}')
    const tree = run(root([{ type: 'element', tagName: 'a', children: [aText] }]))
    const aEl = tree.children?.[0]
    expect(aEl?.children?.[0]).toBe(aText)
  })

  describe('bare amounts in table cells', () => {
    function cell(tagName: 'td' | 'th', ...children: HastNode[]): HastNode {
      return { type: 'element', tagName, children }
    }

    it('turns a bare amount in a td into a span', () => {
      const tree = run(root([cell('td', textNode('29379.01 USD'))]))
      expect(tree.children?.[0]?.children).toEqual([amountSpan('29379.01', 'USD')])
    })

    it('turns a bare negative amount in a th into a span', () => {
      const tree = run(root([cell('th', textNode('-442.17 USD'))]))
      expect(tree.children?.[0]?.children).toEqual([amountSpan('-442.17', 'USD')])
    })

    it('converts a bare amount in a cell nested under table markup', () => {
      const tree = run(
        root([
          {
            type: 'element',
            tagName: 'table',
            children: [
              {
                type: 'element',
                tagName: 'tbody',
                children: [
                  { type: 'element', tagName: 'tr', children: [cell('td', textNode('5.00 USD'))] }
                ]
              }
            ]
          }
        ])
      )
      const td = tree.children?.[0]?.children?.[0]?.children?.[0]?.children?.[0]
      expect(td?.children).toEqual([amountSpan('5.00', 'USD')])
    })

    it('still converts a tagged amount in a cell without leaving stray braces', () => {
      const tree = run(root([cell('td', textNode('{{12.34 USD}}'))]))
      expect(tree.children?.[0]?.children).toEqual([amountSpan('12.34', 'USD')])
    })

    it('keeps surrounding cell text', () => {
      const tree = run(root([cell('td', textNode('up 5.00 USD since May'))]))
      expect(tree.children?.[0]?.children).toEqual([
        textNode('up '),
        amountSpan('5.00', 'USD'),
        textNode(' since May')
      ])
    })

    it('leaves a ticker-like word after the number untouched', () => {
      const node = textNode('1.00 USDC')
      const tree = run(root([cell('td', node)]))
      expect(tree.children?.[0]?.children?.[0]).toBe(node)
    })

    it('leaves a plain text cell untouched', () => {
      const node = textNode('Fidelity ZERO Large Cap Index Fund')
      const tree = run(root([cell('td', node)]))
      expect(tree.children?.[0]?.children?.[0]).toBe(node)
    })

    it('leaves a bare amount outside a cell untouched', () => {
      const node = textNode('29379.01 USD')
      const tree = run(root([node]))
      expect(tree.children?.[0]).toBe(node)
    })

    it('does not start a match mid-number', () => {
      const node = textNode('v1.2 USD build')
      const tree = run(root([cell('td', node)]))
      expect(tree.children?.[0]?.children?.[0]).toBe(node)
    })
  })

  it('passes an incomplete streaming marker through verbatim without throwing', () => {
    const node = textNode('{{1234.')
    expect(() => run(root([node]))).not.toThrow()
    const tree = run(root([node]))
    expect(tree.children?.[0]).toBe(node)
  })
})
