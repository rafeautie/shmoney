import { describe, expect, it } from 'vitest'
import { scrubText, serializeError } from './scrub'

const WIN_HOME = 'C:\\Users\\alice'
const POSIX_HOME = '/home/alice'

describe('scrubText', () => {
  it('replaces a Windows home dir with ~', () => {
    expect(scrubText('opened C:\\Users\\alice\\Code\\app\\db.sqlite', WIN_HOME)).toBe(
      'opened ~\\Code\\app\\db.sqlite'
    )
  })

  it('matches forward-slash and mixed-case variants of the same home', () => {
    expect(scrubText('at file:///c:/users/ALICE/app/out/main.js:1:1', WIN_HOME)).toBe(
      'at file:///~/app/out/main.js:1:1'
    )
  })

  it('replaces every occurrence, not just the first', () => {
    expect(scrubText(`${POSIX_HOME}/a and ${POSIX_HOME}/b`, POSIX_HOME)).toBe('~/a and ~/b')
  })

  it('replaces a POSIX home dir with ~', () => {
    expect(scrubText('ENOENT: /home/alice/.config/shmoney/db', POSIX_HOME)).toBe(
      'ENOENT: ~/.config/shmoney/db'
    )
  })

  it('leaves text without the home dir untouched', () => {
    expect(scrubText('no paths here', WIN_HOME)).toBe('no paths here')
  })

  it('ignores a degenerate home dir rather than mangling the text', () => {
    expect(scrubText('a / b // c', '/')).toBe('a / b // c')
    expect(scrubText('unchanged', '')).toBe('unchanged')
  })
})

describe('serializeError', () => {
  it('uses the stack, scrubbed', () => {
    const err = new Error('boom')
    err.stack = `Error: boom\n    at open (${WIN_HOME}\\app\\out\\main.js:10:5)`
    expect(serializeError(err, WIN_HOME)).toBe(
      'Error: boom\n    at open (~\\app\\out\\main.js:10:5)'
    )
  })

  it('prefixes a Node error code', () => {
    const err = new Error('no such file') as NodeJS.ErrnoException
    err.code = 'ENOENT'
    err.stack = 'Error: no such file'
    expect(serializeError(err, WIN_HOME)).toBe('[ENOENT] Error: no such file')
  })

  it('falls back to name and message when there is no stack', () => {
    const err = new Error('boom')
    err.stack = undefined
    expect(serializeError(err, WIN_HOME)).toBe('Error: boom')
  })

  it('caps oversized messages', () => {
    const err = new Error('x'.repeat(5000))
    const out = serializeError(err, WIN_HOME)
    expect(out.length).toBeLessThanOrEqual(2001)
    expect(out.endsWith('…')).toBe(true)
  })

  it('serializes non-Error throws', () => {
    expect(serializeError('plain string', WIN_HOME)).toBe('plain string')
    expect(serializeError({ reason: 'odd' }, WIN_HOME)).toBe('{"reason":"odd"}')
    expect(serializeError(undefined, WIN_HOME)).toBe('undefined')
  })
})
