import { describe, it, expect } from 'vitest'
import { decodeBuffer, sniffFormat, parseOfx, parseQif } from './parse'

// imported rows anchor calendar dates at local noon (month is 0-based here)
const noon = (y: number, m0: number, d: number): number => new Date(y, m0, d, 12).getTime() / 1000

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>0001
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20240101
<DTEND>20240131
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115120000
<TRNAMT>-42.50
<FITID>202401150001
<NAME>COFFEE SHOP
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240116
<TRNAMT>1000.00
<FITID>202401160002
<NAME>PAYCHECK
<MEMO>EMPLOYER INC
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>`

const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>1</TRNUID>
      <CCSTMTRS>
        <CURDEF>USD</CURDEF>
        <BANKTRANLIST>
          <DTSTART>20240201</DTSTART>
          <DTEND>20240228</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20240210</DTPOSTED>
            <TRNAMT>-15.99</TRNAMT>
            <FITID>F1</FITID>
            <NAME>STREAMING SVC</NAME>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`

const QIF = `!Type:Bank
D1/15/2024
T-42.50
PCOFFEE SHOP
^
D1/16/2024
T1,000.00
PPAYCHECK
MEMPLOYER INC
^`

describe('decodeBuffer', () => {
  it('decodes utf-8', () => {
    expect(decodeBuffer(new TextEncoder().encode('café'))).toBe('café')
  })

  it('falls back to windows-1252 for latin-1 bytes', () => {
    // 0xE9 = é in windows-1252, invalid as a lone utf-8 byte
    expect(decodeBuffer(new Uint8Array([0x63, 0x61, 0x66, 0xe9]))).toBe('café')
  })
})

describe('sniffFormat', () => {
  it('trusts the extension first', () => {
    expect(sniffFormat('export.qfx', '')).toBe('ofx')
    expect(sniffFormat('export.QIF', '')).toBe('qif')
    expect(sniffFormat('export.tsv', '')).toBe('csv')
  })

  it('sniffs content when the extension is unknown', () => {
    expect(sniffFormat('statement.txt', OFX_SGML)).toBe('ofx')
    expect(sniffFormat('statement.txt', OFX_XML)).toBe('ofx')
    expect(sniffFormat('statement.txt', QIF)).toBe('qif')
    expect(sniffFormat('statement.txt', 'Date,Amount\n1/1/2024,5')).toBe('csv')
  })
})

describe('parseOfx', () => {
  it('parses OFX 1.x SGML bank statements', () => {
    const rows = parseOfx(OFX_SGML)
    expect(rows).toEqual([
      {
        posted: noon(2024, 0, 15),
        amount: -42500,
        description: 'COFFEE SHOP',
        fitid: '202401150001'
      },
      {
        posted: noon(2024, 0, 16),
        amount: 1000000,
        description: 'PAYCHECK',
        fitid: '202401160002'
      }
    ])
  })

  it('parses OFX 2.x XML credit-card statements', () => {
    const rows = parseOfx(OFX_XML)
    expect(rows).toEqual([
      {
        posted: noon(2024, 1, 10),
        amount: -15990,
        description: 'STREAMING SVC',
        fitid: 'F1'
      }
    ])
  })
})

describe('parseQif', () => {
  it('parses bank transactions with comma amounts', () => {
    const rows = parseQif(QIF)
    expect(rows).toEqual([
      { posted: noon(2024, 0, 15), amount: -42500, description: 'COFFEE SHOP' },
      { posted: noon(2024, 0, 16), amount: 1000000, description: 'PAYCHECK' }
    ])
  })

  it('handles an !Account preamble, U lines, and day-first dates', () => {
    const qif = `!Account
NChecking
TBank
^
!Type:Bank
D25/12/2023
U-5.00
T-5.00
PMINCE PIES
^`
    const rows = parseQif(qif)
    expect(rows).toEqual([{ posted: noon(2023, 11, 25), amount: -5000, description: 'MINCE PIES' }])
  })

  it("handles Quicken apostrophe years (12/25'04)", () => {
    const rows = parseQif(`!Type:Bank\nD12/25'04\nT-1.00\nPX\n^`)
    expect(rows[0].posted).toBe(noon(2004, 11, 25))
  })

  it('handles Chase-style blank-line record separators (no ^ at all)', () => {
    const qif = `!Type:CCard
C*
D07/12/2026
NN/A
PPAYPAL *MICROSOFT
T-13.99

C*
D07/12/2026
NN/A
PSpotify USA
T-21.99`
    const rows = parseQif(qif)
    expect(rows).toEqual([
      { posted: noon(2026, 6, 12), amount: -13990, description: 'PAYPAL *MICROSOFT' },
      { posted: noon(2026, 6, 12), amount: -21990, description: 'Spotify USA' }
    ])
  })

  it('flushes a trailing record that has no terminator', () => {
    const rows = parseQif(`!Type:Bank\nD1/2/2024\nT-1.00\nPX`)
    expect(rows).toHaveLength(1)
  })
})
