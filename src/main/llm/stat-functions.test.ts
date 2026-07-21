import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { registerStatFunctions } from './stat-functions'

// The definitions are exercised through a real node:sqlite connection (the same
// binding the SQL suites use), so the test covers the registrar and the
// aggregate wiring, not just the accumulator math in isolation.

function open(rows: [number | null, string][]): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  registerStatFunctions((name, def) => db.aggregate(name, def as never))
  db.exec('CREATE TABLE t(x REAL, g TEXT)')
  const insert = db.prepare('INSERT INTO t(x, g) VALUES (?, ?)')
  for (const [x, g] of rows) insert.run(x, g)
  return db
}

const one = (sql: string, db: DatabaseSync): number | null =>
  (db.prepare(sql).get() as { v: number | null }).v

describe('stat aggregates', () => {
  describe('median', () => {
    it('takes the middle of an odd count', () => {
      expect(
        one(
          'SELECT median(x) v FROM t',
          open([
            [1, 'a'],
            [3, 'a'],
            [2, 'a']
          ])
        )
      ).toBe(2)
    })
    it('averages the two middle values of an even count', () => {
      const db = open([
        [1, 'a'],
        [2, 'a'],
        [3, 'a'],
        [4, 'a']
      ])
      expect(one('SELECT median(x) v FROM t', db)).toBe(2.5)
    })
    it('resists an outlier the average cannot', () => {
      // [1,2,3,4,100]: median 3, mean 22, the whole reason MEDIAN exists
      const db = open([
        [1, 'a'],
        [2, 'a'],
        [3, 'a'],
        [4, 'a'],
        [100, 'a']
      ])
      expect(one('SELECT median(x) v FROM t', db)).toBe(3)
      expect(one('SELECT ROUND(AVG(x), 2) v FROM t', db)).toBe(22)
    })
  })

  describe('percentile', () => {
    const db = (): DatabaseSync =>
      open([
        [1, 'a'],
        [2, 'a'],
        [3, 'a'],
        [4, 'a'],
        [5, 'a']
      ])
    it('returns the exact value at an aligned rank', () => {
      expect(one('SELECT percentile(x, 0) v FROM t', db())).toBe(1)
      expect(one('SELECT percentile(x, 50) v FROM t', db())).toBe(3)
      expect(one('SELECT percentile(x, 100) v FROM t', db())).toBe(5)
    })
    it('interpolates between ranks', () => {
      // rank = 0.9 * (5-1) = 3.6 -> between index 3 (4) and 4 (5): 4.6
      expect(one('SELECT percentile(x, 90) v FROM t', db())).toBeCloseTo(4.6, 10)
    })
    it('clamps p outside 0..100', () => {
      expect(one('SELECT percentile(x, 150) v FROM t', db())).toBe(5)
    })
  })

  describe('stddev', () => {
    it('computes the sample standard deviation', () => {
      // [2,4,4,4,5,5,7,9]: sample stddev = sqrt(32/7) ~ 2.138
      const db = open([
        [2, 'a'],
        [4, 'a'],
        [4, 'a'],
        [4, 'a'],
        [5, 'a'],
        [5, 'a'],
        [7, 'a'],
        [9, 'a']
      ])
      expect(one('SELECT stddev(x) v FROM t', db)).toBeCloseTo(2.13809, 4)
    })
    it('is null under two values', () => {
      expect(one('SELECT stddev(x) v FROM t', open([[42, 'a']]))).toBeNull()
    })
  })

  describe('no-data and grouping', () => {
    it('returns null rather than 0 when nothing matched', () => {
      const db = open([[1, 'a']])
      expect(one("SELECT median(x) v FROM t WHERE g = 'z'", db)).toBeNull()
      expect(one("SELECT stddev(x) v FROM t WHERE g = 'z'", db)).toBeNull()
    })
    it('composes with GROUP BY, one value per group', () => {
      const db = open([
        [10, 'a'],
        [20, 'a'],
        [30, 'a'],
        [5, 'b']
      ])
      const rows = db.prepare('SELECT g, median(x) m FROM t GROUP BY g ORDER BY g').all()
      expect(rows).toEqual([
        { g: 'a', m: 20 },
        { g: 'b', m: 5 }
      ])
    })
    it('skips non-numeric and null values', () => {
      // the NULL row is ignored, so the median is of [10, 30]
      const db = open([
        [10, 'a'],
        [null, 'a'],
        [30, 'a']
      ])
      expect(one('SELECT median(x) v FROM t', db)).toBe(20)
    })
  })
})
