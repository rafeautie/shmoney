// Bank descriptions carry store numbers, order codes and processor prefixes
// ("SQ *TACOS EL GORDO", "AMAZON.COM*RT4K21", "WHOLE FOODS MKT #10233"), so
// grouping by raw description splits one merchant into many rows. This is the
// one normalizer; it's registered on the tool connection as MERCHANT() so the
// tx view's merchant column and every tool group identically.

// processors whose name comes first and the merchant after the '*'
const PROCESSORS = new Set(['SQ', 'TST', 'SP', 'PAYPAL', 'PP', 'PY', 'IC', 'GOOGLE'])

// kept upper-case: a short all-letter leading name reads as an acronym (CVS,
// AMC, REI); later short words are ordinary words (Tacos El Gordo, Foods Mkt)
const ACRONYM = /^[A-Z]{2,3}$/
const NOT_ACRONYMS = new Set(['THE', 'EL', 'LA', 'LE', 'DE', 'MY', 'AN', 'OF', 'AND'])

function titleWord(word: string, leading: boolean): string {
  return word
    .split('/')
    .map((piece, i) =>
      (leading || i > 0) && ACRONYM.test(piece) && !NOT_ACRONYMS.has(piece)
        ? piece
        : piece
            .toLowerCase()
            .replace(/(^|-)([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    )
    .join('/')
}

export function merchantOf(description: string | null): string | null {
  if (description == null) return null
  // payment rails name the payee after themselves ("ZELLE PAYMENT TO OAKWOOD")
  let s = description
    .trim()
    .toUpperCase()
    .replace(/^(ZELLE|VENMO|PAYPAL|CASH APP)\s+(PAYMENT\s+)?(TO|FROM)\s+/, '')
  if (!s) return null
  const star = s.indexOf('*')
  if (star > 0) {
    const head = s.slice(0, star).trim()
    const tail = s.slice(star + 1).trim()
    s = PROCESSORS.has(head) && tail ? tail : head
  }
  s = s
    // a store or order number and anything after it
    .replace(/\s*#\s*\d.*$/, '')
    .replace(/\s+[A-Z]?-?\d{2,}\b.*$/, '')
    // web suffixes: AMAZON.COM, APPLE.COM/BILL, NETFLIX.COM
    .replace(/\.(COM|NET|ORG|CO)\b(\/\S*)?/g, '')
    .replace(/\s+(PPD|ACH|WEB|ONLINE|POS|DEBIT|PURCHASE)\b.*$/, '')
    .replace(/\s+(USA|US|INC|LLC)$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (!s) return description.trim()
  return s
    .split(' ')
    .map((word, i) => titleWord(word, i === 0))
    .join(' ')
}
