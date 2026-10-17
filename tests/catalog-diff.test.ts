import { describe, expect, it } from 'vitest';
import { diffCatalogs } from '../src/core/catalogBuilder';
import type { Catalog, Product } from '../src/core/types';

function product(code: string, spec: string, brand = '海大'): Product {
  return { code, name: '轮胎（海大）', spec, brand, unit: '条' };
}

function catalog(products: Product[]): Catalog {
  return { version: 'test', generatedAt: '2026-01-01T00:00:00.000Z', products };
}

describe('catalog diff', () => {
  it('reports added, removed, changed and brand counts', () => {
    const before = catalog([
      product('A', '165R14LT HD517'),
      product('B', '175R14LT HD517'),
      product('C', '185R14LT HD517'),
    ]);
    const after = catalog([
      product('A', '165R14LT HD517'),
      product('B', '175R14LT HD517 8PR'),
      product('D', '205/55R16 HD687'),
      product('E', '145R12C RD-224', '天府'),
    ]);
    const diff = diffCatalogs(before, after);
    expect(diff.added.map((item) => item.code)).toEqual(['D', 'E']);
    expect(diff.removed.map((item) => item.code)).toEqual(['C']);
    expect(diff.changed.map((item) => item.after.code)).toEqual(['B']);
    expect(diff.brandCounts).toEqual([
      { brand: '海大', count: 3 },
      { brand: '天府', count: 1 },
    ]);
  });
});
