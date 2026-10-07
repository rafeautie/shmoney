import { describe, expect, it } from 'vitest'
import type { CsvMapping, PickFileResult } from '@shared/import'
import { api } from './harness/api'
import { account, category, noon, txn } from './harness/builders'
import { count, query } from './harness/db'

type Picked = Exclude<PickFileResult, null>
type CsvPicked = Extract<Picked, { kind: 'csv' }>

const enc = (text: string): Uint8Array => new TextEncoder().encode(text)

async function pickBytes(bytes: Uint8Array, fileName: string): Promise<Picked> {
  const result = await api.import.pickFile({ dropped: { fileName, bytes } })
  if (!result) throw new Error('canceled')
  return result
}

const pick = (text: string, fileName: string): Promise<Picked> => pickBytes(enc(text), fileName)

async function pickCsv(text: string, fileName = 'bank.csv'): Promise<CsvPicked> {
  const file = await pick(text, fileName)
  if (file.kind !== 'csv') throw new Error(`expected csv, got ${file.format}`)
  return file
}

const SINGLE: CsvMapping = {
  dateColumn: 0,
  dateFormat: 'MM/dd/yyyy',
  descriptionColumn: 1,
  amount: { kind: 'single', column: 2, invert: false }
}

const SGML_OFX = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20240131<LANGUAGE>ENG</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>USD<BANKACCTFROM><BANKID>123<ACCTID>456<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20240101<DTEND>20240131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240105120000<TRNAMT>-4.50<FITID>A1<NAME>Coffee</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20240106<TRNAMT>1500.00<FITID>A2<NAME>Paycheck</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`

describe('pickFile', () => {
  it('releases the previous handle when a new file is picked', async () => {
    const first = await pickCsv('Date,Description,Amount\n01/05/2024,One,-1.00')
    const second = await pickCsv('Date,Description,Amount\n01/06/2024,Two,-2.00')
    await expect(api.import.preview({ handle: first.handle, mapping: SINGLE })).rejects.toThrow(
      /no longer loaded/
    )
    const preview = await api.import.preview({ handle: second.handle, mapping: SINGLE })
    expect(preview.rows.map((r) => r.description)).toEqual(['Two'])
  })

  it('decodes a non-utf-8 file as windows-1252', async () => {
    const bytes = Buffer.from(
      'Date,Description,Amount\n01/05/2024,Caf\u00e9 d\u00e9j\u00e0 vu,-4.50',
      'latin1'
    )
    const file = await pickBytes(bytes, 'latin1.csv')
    if (file.kind !== 'csv') throw new Error('expected csv')
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE })
    expect(preview.rows[0].description).toBe('Caf\u00e9 d\u00e9j\u00e0 vu')
  })

  it('sniffs OFX from content when the file has no extension', async () => {
    expect(await pick(SGML_OFX, 'statement')).toMatchObject({
      kind: 'rows',
      format: 'ofx',
      rowCount: 2
    })
  })

  it('sniffs QIF from content when the extension is unhelpful', async () => {
    expect(await pick('!Type:Bank\nD1/2/2024\nT-1.00\nPX\n^', 'export.txt')).toMatchObject({
      kind: 'rows',
      format: 'qif',
      rowCount: 1
    })
  })

  it('falls back to csv for an unrecognized file', async () => {
    expect(await pick('Date,Description,Amount\n01/05/2024,X,-1.00', 'export')).toMatchObject({
      kind: 'csv',
      rowCount: 1
    })
  })

  it('reads an empty CSV as no headers, no rows and no suggested mapping', async () => {
    const file = await pickCsv('')
    expect(file).toMatchObject({ headers: [], sampleRows: [], rowCount: 0, suggestedMapping: null })
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE })
    expect(preview).toEqual({ rows: [], errors: [] })
  })
})

describe('CSV through preview', () => {
  it('maps separate debit and credit columns, treating a zero-filled side as unused', async () => {
    const file = await pickCsv(
      [
        'Date,Description,Debit,Credit',
        '01/05/2024,Rent,1200.00,',
        '01/06/2024,Refund,,35.25',
        '01/07/2024,Fee,20.00,0.00'
      ].join('\n')
    )
    expect(file.suggestedMapping?.amount).toEqual({
      kind: 'debitCredit',
      debitColumn: 2,
      creditColumn: 3
    })
    const preview = await api.import.preview({
      handle: file.handle,
      mapping: file.suggestedMapping!
    })
    expect(preview.rows.map((r) => [r.description, r.amount])).toEqual([
      ['Rent', -1_200_000],
      ['Refund', 35_250],
      ['Fee', -20_000]
    ])
  })

  it('inverts every sign for a bank that reports money out as positive', async () => {
    const file = await pickCsv(
      'Date,Description,Amount\n01/05/2024,Gas,40.00\n01/06/2024,Return,-10.00'
    )
    const mapping: CsvMapping = { ...SINGLE, amount: { kind: 'single', column: 2, invert: true } }
    const preview = await api.import.preview({ handle: file.handle, mapping })
    expect(preview.rows.map((r) => r.amount)).toEqual([-40_000, 10_000])
  })

  it('detects a day-first date format from a value with day above 12', async () => {
    const file = await pickCsv('Date,Description,Amount\n13/01/2024,A,-1.00\n02/02/2024,B,-2.00')
    expect(file.suggestedMapping?.dateFormat).toBe('d/M/yyyy')
    const preview = await api.import.preview({
      handle: file.handle,
      mapping: file.suggestedMapping!
    })
    expect(preview.rows.map((r) => r.posted)).toEqual([noon(2024, 1, 13), noon(2024, 2, 2)])
  })

  it('reports bad rows by 1-based data line and still previews the good ones', async () => {
    const file = await pickCsv(
      [
        'Date,Description,Amount',
        '01/05/2024,Fine,-1.00',
        'not a date,Bad date,-2.00',
        '01/07/2024,No amount,',
        '01/08/2024,Also fine,-4.00'
      ].join('\n')
    )
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE })
    expect(preview.rows.map((r) => r.description)).toEqual(['Fine', 'Also fine'])
    expect(preview.errors).toEqual([
      { line: 2, message: 'Unparseable date: "not a date"' },
      { line: 3, message: 'Missing or unparseable amount' }
    ])
  })

  it('reads European decimal commas in a semicolon file', async () => {
    const file = await pickCsv(
      ['Date;Description;Amount', '01/05/2024;Rent;-1.234,56', '01/06/2024;Bakery;-3,20'].join('\n')
    )
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE })
    expect(preview.rows.map((r) => r.amount)).toEqual([-1_234_560, -3_200])
  })

  it('requires a mapping to preview a CSV', async () => {
    const file = await pickCsv('Date,Description,Amount\n01/05/2024,X,-1.00')
    await expect(api.import.preview({ handle: file.handle })).rejects.toThrow(
      /column mapping is required/
    )
  })

  it('imports zero-amount rows, dated at local noon', async () => {
    const file = await pickCsv('Date,Description,Amount\n03/15/2024,Zero adjustment,0.00')
    const result = await api.import.apply({
      handle: file.handle,
      mapping: SINGLE,
      excluded: [],
      target: { newAccount: { name: 'Zero account', currency: 'USD' } }
    })
    expect(result.inserted).toBe(1)
    expect(
      query(`SELECT amount, posted FROM transactions WHERE account_id = ${result.accountId}`)
    ).toEqual([{ amount: 0, posted: noon(2024, 3, 15) }])
  })
})

describe('OFX', () => {
  const XML_OFX = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><DTSERVER>20240131</DTSERVER><LANGUAGE>ENG</LANGUAGE></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<STMTRS><CURDEF>USD</CURDEF><BANKACCTFROM><BANKID>1</BANKID><ACCTID>2</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20240101</DTSTART><DTEND>20240131</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240110</DTPOSTED><TRNAMT>-20.00</TRNAMT><FITID>X1</FITID><NAME>Bank leg</NAME></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>2</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<CCSTMTRS><CURDEF>USD</CURDEF><CCACCTFROM><ACCTID>9</ACCTID></CCACCTFROM>
<BANKTRANLIST><DTSTART>20240101</DTSTART><DTEND>20240131</DTEND>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20240111</DTPOSTED><TRNAMT>-7.25</TRNAMT><FITID>X2</FITID><MEMO>Memo only</MEMO></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`

  it('parses SGML rows with FITID ids, amounts and local-noon dates', async () => {
    const file = await pick(SGML_OFX, 'bank.ofx')
    const preview = await api.import.preview({ handle: file.handle })
    expect(preview.rows).toEqual([
      {
        externalId: 'import:fitid:A1',
        posted: noon(2024, 1, 5),
        amount: -4_500,
        description: 'Coffee',
        status: 'new'
      },
      {
        externalId: 'import:fitid:A2',
        posted: noon(2024, 1, 6),
        amount: 1_500_000,
        description: 'Paycheck',
        status: 'new'
      }
    ])
  })

  it('walks bank and credit-card statements in an XML file', async () => {
    const file = await pick(XML_OFX, 'both.qfx')
    expect(file).toMatchObject({ kind: 'rows', format: 'ofx', rowCount: 2 })
    const preview = await api.import.preview({ handle: file.handle })
    expect(preview.rows.map((r) => [r.externalId, r.description])).toEqual([
      ['import:fitid:X1', 'Bank leg'],
      ['import:fitid:X2', 'Memo only']
    ])
  })

  it('counts a FITID repeated within a file as skipped on apply', async () => {
    const doubled = SGML_OFX.replace(
      '</BANKTRANLIST>',
      '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20240107<TRNAMT>-4.50<FITID>A1<NAME>Coffee again</STMTTRN></BANKTRANLIST>'
    )
    const file = await pick(doubled, 'dup.ofx')
    const result = await api.import.apply({
      handle: file.handle,
      excluded: [],
      target: { newAccount: { name: 'Repeated FITID', currency: 'USD' } }
    })
    expect(result).toMatchObject({ inserted: 2, skipped: 1 })
    const kept = query<{ description: string }>(
      `SELECT description FROM transactions WHERE account_id = ${result.accountId} AND simplefin_id = 'import:fitid:A1'`
    )
    expect(kept).toEqual([{ description: 'Coffee' }])
  })

  it('rejects a file with an unparseable date', async () => {
    const broken = SGML_OFX.replace('<DTPOSTED>20240106', '<DTPOSTED>yesterday')
    await expect(pick(broken, 'broken.ofx')).rejects.toThrow(/Unparseable OFX date/)
  })
})

describe('QIF', () => {
  it('reads blank-line record separators and comma thousands, as Chase exports', async () => {
    const text = [
      '!Type:Bank',
      'D01/05/2024',
      'T-4.50',
      'PCoffee',
      '',
      'D01/06/2024',
      'T1,500.00',
      'PPaycheck'
    ].join('\n')
    const file = await pick(text, 'chase.qif')
    expect(file).toMatchObject({ kind: 'rows', format: 'qif', rowCount: 2 })
    const preview = await api.import.preview({ handle: file.handle })
    expect(preview.rows.map((r) => [r.description, r.amount, r.posted])).toEqual([
      ['Coffee', -4_500, noon(2024, 1, 5)],
      ['Paycheck', 1_500_000, noon(2024, 1, 6)]
    ])
    expect(preview.rows[0].externalId).toMatch(/^import:h1:[0-9a-f]{64}:0$/)
  })

  it('rejects a date format it does not recognize', async () => {
    await expect(pick('!Type:Bank\nD2024.01.05\nT-1.00\nPX\n^', 'odd.qif')).rejects.toThrow(
      /Unrecognized QIF date format/
    )
  })

  it('numbers identical rows in one file so both import', async () => {
    const twice = '!Type:Bank\nD01/05/2024\nT-3.00\nPSame\n^\nD01/05/2024\nT-3.00\nPSame\n^'
    const file = await pick(twice, 'twice.qif')
    const result = await api.import.apply({
      handle: file.handle,
      excluded: [],
      target: { newAccount: { name: 'Twins', currency: 'USD' } }
    })
    expect(result).toMatchObject({ inserted: 2, skipped: 0 })
  })
})

describe('row statuses against an existing account', () => {
  const FILE = 'Date,Description,Amount\n01/05/2024,Status One,-11.00\n01/06/2024,Status Two,-12.00'

  async function importInto(
    target: Parameters<typeof api.import.apply>[0]['target'],
    excluded: string[] = []
  ): Promise<number> {
    const file = await pickCsv(FILE)
    const result = await api.import.apply({
      handle: file.handle,
      mapping: SINGLE,
      excluded,
      target
    })
    return result.accountId
  }

  async function statuses(accountId?: number): Promise<string[]> {
    const file = await pickCsv(FILE)
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE, accountId })
    return preview.rows.map((r) => r.status)
  }

  it('marks rows already live in the account as duplicates', async () => {
    const accountId = await importInto({ newAccount: { name: 'Dupes', currency: 'USD' } })
    expect(await statuses(accountId)).toEqual(['duplicate', 'duplicate'])
  })

  it('previews a soft-deleted row as new and apply restores it in place with its category', async () => {
    const accountId = await importInto({ newAccount: { name: 'Restore', currency: 'USD' } })
    const [first] = query<{ id: number }>(
      `SELECT id FROM transactions WHERE account_id = ${accountId} ORDER BY posted`
    )
    const food = category('Restored food')
    await api.transactions.setCategories({
      changes: [{ transactionId: first.id, categoryId: food }]
    })
    await api.transactions.bulkDelete({ transactionIds: [first.id] })

    expect(await statuses(accountId)).toEqual(['new', 'duplicate'])

    const file = await pickCsv(FILE)
    const result = await api.import.apply({
      handle: file.handle,
      mapping: SINGLE,
      excluded: [],
      target: { accountId }
    })
    expect(result).toMatchObject({ inserted: 1, skipped: 0 })
    expect(count('transactions', `account_id = ${accountId}`)).toBe(2)
    expect(
      query(`SELECT category_id, deleted_at FROM transactions WHERE id = ${first.id}`)
    ).toEqual([{ category_id: food, deleted_at: null }])
  })

  it('marks a same-day same-amount row on another id as probable and imports it by default', async () => {
    const accountId = account({ name: 'Probable' })
    txn(accountId, { posted: noon(2024, 1, 5), amount: -11_000, description: 'Typed by hand' })
    expect(await statuses(accountId)).toEqual(['probable', 'new'])
    await importInto({ accountId })
    expect(count('transactions', `account_id = ${accountId}`)).toBe(3)
  })

  it('leaves a probable row out when the user excludes it', async () => {
    const accountId = account({ name: 'Probable excluded' })
    txn(accountId, { posted: noon(2024, 1, 5), amount: -11_000, description: 'Typed by hand' })
    const file = await pickCsv(FILE)
    const preview = await api.import.preview({ handle: file.handle, mapping: SINGLE, accountId })
    const result = await api.import.apply({
      handle: file.handle,
      mapping: SINGLE,
      excluded: [preview.rows[0].externalId],
      target: { accountId }
    })
    expect(result.inserted).toBe(1)
  })

  it('treats every row as new when the target is a brand-new account', async () => {
    const accountId = account({ name: 'Elsewhere' })
    txn(accountId, { posted: noon(2024, 1, 5), amount: -11_000 })
    expect(await statuses()).toEqual(['new', 'new'])
    const result = await importInto({ newAccount: { name: 'Fresh', currency: 'USD' } })
    expect(count('transactions', `account_id = ${result}`)).toBe(2)
  })
})
