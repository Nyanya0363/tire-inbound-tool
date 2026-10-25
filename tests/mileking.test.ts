import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haidaAdapter as adapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import { buildImportRows } from '../src/core/excel';
import { normalizeBrand } from '../src/core/text';
import type { Catalog } from '../src/core/types';

const index = buildBrandIndex(JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog, adapter);

describe('Mileking in the Haida supplier configuration', () => {
  it.each(['迈劲', 'MILEKING'])('allows the brand column %s', brand => {
    expect(adapter.brandAliases.some(alias => normalizeBrand(alias) === normalizeBrand(brand))).toBe(true);
    const result = matchRow(2, '185R14C 8PR 102/100R MK501', adapter, index, {}, brand);
    expect(result.status).toBe('matched');
    expect(result.product?.code).toBe('MK501-185R14C');
    expect(result.product?.brand).toBe('迈劲');
  });

  it.each(['MILEKING', '迈劲', ''])('recognizes brand and MK pattern from model %s', prefix => {
    const result = matchRow(2, `${prefix} LT245/70R17 6PR 108/104S MK828`, adapter, index, {});
    expect(result.parsed?.brand).toBe('迈劲');
    expect(result.status).toBe('matched');
    expect(result.product?.code).toBe('MK828-LT245/70R17');
    expect(result.parsed?.unrecognized).toBeUndefined();
  });

  it('exports all three brands to the same supplier while keeping their product identities', () => {
    const models = ['HAIDA 165R14LT 8PR 96/95Q HD517', 'TIANFU 145R12LT 8PR 86/84Q RD-224', 'MILEKING 185R14C 8PR 102/100R MK501'];
    const rows = models.map((model, n) => ({ rowNumber: n + 2, model, qty: 2, price: 100, brand: '', unit: '条', source: {} }));
    const results = rows.map(row => matchRow(row.rowNumber, row.model, adapter, index, {}));
    expect(results.every(r => r.status === 'matched')).toBe(true);
    const output = buildImportRows(rows, new Map(results.map(r => [r.trace.rowNumber, r.product!])), adapter.supplierName);
    expect(output.map(r => r.code)).toEqual(['HD517-165R14LT', 'BH003019', 'MK501-185R14C']);
    expect(new Set(output.map(r => r.supplier))).toEqual(new Set([adapter.supplierName]));
  });

  it('flags legacy MK products whose catalog brand is Haida', () => {
    const parsed = adapter.parseProduct(index.byCode.get('mk668-H225/60R18')!);
    expect(parsed?.issues?.join()).toContain('请核对商品目录品牌');
  });
});
