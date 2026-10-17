import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import type { Catalog } from '../src/core/types';

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog;
const index = buildBrandIndex(catalog, haidaAdapter);

const samples: Array<{ row: number; model: string; expected: string | null }> = [
  { row: 1, model: 'HAIDA 165R14LT 8PR 96/95Q  HD517', expected: 'HD517-165R14LT' },
  { row: 2, model: 'HAIDA 175R14LT 8PR 99/97R  HD517', expected: 'HD517-175R14LT' },
  { row: 3, model: 'HAIDA 175R14LT 6PR 94/92R  HD517', expected: null },
  { row: 4, model: 'HAIDA 185R14LT 8PR低滚阻 102/100S  HD718', expected: 'HD718-185R14LT' },
  { row: 5, model: 'HAIDA 175/70R14 88S XL HD618', expected: 'HD618-175/70R14XL' },
  { row: 6, model: 'HAIDA 175/75R14C 8PR 99/98R  HD517', expected: 'HD517-175/75R14C' },
  { row: 7, model: 'HAIDA 185R15LT 6PR增强型 98/97S  HD517', expected: 'HD517-185R15LT6PR' },
  { row: 8, model: 'HAIDA 205/50R17 93V XL HD665 EV', expected: 'HD665EV-205/50R17' },
  { row: 9, model: 'HAIDA LT235/70R16 6PR 104/101Q  HD828', expected: 'HD828-LT235/70R16' },
  { row: 10, model: 'HAIDA LT245/70R17 6PR 108/104S  HD828', expected: 'HD828-LT245/70R17' },
  { row: 11, model: 'HAIDA 185/65R15LT 12PR 103/100Q  HD718 pro', expected: 'HD718-185/65R15LT' },
  { row: 12, model: 'HAIDA 235/50ZR20 104W XL HD937', expected: 'HD937-H235/50ZR20' },
  { row: 13, model: 'HAIDA 235/55R19 105V XL HD927', expected: 'HD927-H235/55R19XL' },
  { row: 14, model: 'HAIDA 235/55R19  101V  HD937', expected: 'HD937-235/55R19' },
  { row: 15, model: 'HAIDA 255/40ZR19 100Y XL HD937', expected: 'HD937-H255/40ZR19' },
  { row: 16, model: 'HAIDA 255/45ZR19 104Y XL HD937', expected: 'HD937-H255/45ZR19' },
  { row: 17, model: 'HAIDA 165/70R12 77T  HD667', expected: 'HD667-H165/70R12' },
  { row: 18, model: 'HAIDA 245/50R20 102V  HD937', expected: 'HD937-H245/50R20' },
  { row: 19, model: 'HAIDA 255/40ZR21 102Y XL HD937', expected: 'HD937-H255/40ZR21' },
  { row: 20, model: 'HAIDA LT255/60R19 8PR白字 113/110Q  HD877 Pro', expected: 'HD877-LT255/60R19' },
  { row: 21, model: 'HAIDA 315/35ZR21 111Y XL HD937', expected: 'HD937-H315/35ZR21' },
];

describe('HAIDA adapter', () => {
  it('parses the example model', () => {
    const parsed = haidaAdapter.parseInbound('HAIDA 165R14LT 8PR 96/95Q  HD517');
    expect(parsed).toMatchObject({
      brand: '海大',
      pattern: 'HD517',
      size: '165R14LT',
      ply: '8PR',
      loadSpeed: '96/95Q',
    });
  });

  it('parses EV as part of the pattern and XL as a flag', () => {
    const parsed = haidaAdapter.parseInbound('HAIDA 205/50R17 93V XL HD665 EV');
    expect(parsed.pattern).toBe('HD665EV');
    expect(parsed.flags).toContain('XL');
    expect(parsed.loadSpeed).toBe('93V');
  });

  it('does not match 6PR to the existing 8PR product', () => {
    const result = matchRow(3, samples[2].model, haidaAdapter, index, {});
    expect(result.status).not.toBe('matched');
    expect(result.product).toBeUndefined();
  });

  it('matches all 20 known HAIDA rows and leaves row 3 unresolved', () => {
    const results = samples.map((sample) =>
      matchRow(sample.row, sample.model, haidaAdapter, index, {}),
    );
    const matched = results.filter((result) => result.status === 'matched');
    expect(matched).toHaveLength(20);
    results.forEach((result, i) => {
      const expected = samples[i].expected;
      if (expected) {
        expect(result.status).toBe('matched');
        expect(result.product?.code).toBe(expected);
      } else {
        expect(result.status).not.toBe('matched');
      }
    });
  });
});
