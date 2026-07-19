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

  it('passes an incomplete streaming marker through verbatim without throwing', () => {
    const node = textNode('{{1234.')
    expect(() => run(root([node]))).not.toThrow()
    const tree = run(root([node]))
    expect(tree.children?.[0]).toBe(node)
  })
})
