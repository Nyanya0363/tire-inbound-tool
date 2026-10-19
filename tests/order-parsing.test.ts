import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import type { Catalog } from '../src/core/types';

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog;
const index = buildBrandIndex(catalog, haidaAdapter);

describe('October 17 order parsing regressions', () => {
  it('prompts for manual new-product identification when the ordered product is absent', () => {
    const result = matchRow(32, 'HAIDA 245/60R18 105H HI-SPIRIT', haidaAdapter, index, {}, '海大');
    expect(result.reason).toContain('疑似未建档');
    expect(result.reason).toContain('人工核对');
    expect(result.reason).toContain('回业务系统新建');
    expect(result.product).toBeUndefined();
    expect(result.status).not.toBe('matched');
    expect(result.trace.reason).toBe(result.reason);
  });

  it('recognizes the named EX-COMFORT pattern and matches the existing product', () => {
    const result = matchRow(31, 'HAIDA 245/45ZR18 100W XL EX-COMFORT', haidaAdapter, index, {}, '海大');
    expect(result.parsed).toMatchObject({ pattern: 'EX-COMFORT', size: '245/45ZR18', loadSpeed: '100W', flags: ['XL'] });
    expect(result.method).toBe('exact');
    expect(result.product?.code).toBe('EX-H245/45ZR18');
  });

  it.each([
    ['HAIDA 245/70R16 111H XL HI-SPIRIT', '海大', 'HI-245/70R16'],
    ['245/70R16 111H XL HI-SPIRIT', '海大', 'HI-245/70R16'],
    ['TIANFU 235/60R17 106H XL HI-SPIRIT', '天府', 'HI-SPIRIT-235/60R17'],
  ])('does not infer brand from the shared HI-SPIRIT pattern: %s', (model, brand, code) => {
    const result = matchRow(1, model, haidaAdapter, index, {});
    expect(result.parsed?.brand).toBe(brand);
    expect(result.product?.code).toBe(code);
  });

  it.each([
    ['HAIDA 185R14C 8PR 102/100R EV HD501', 'HD501-185R14C'],
    ['HAIDA 255/45ZR20 105W XL HD937', 'HD937-H255/45ZR20XL'],
  ])('reuses the owner-confirmed association for %s', (model, code) => {
    const result = matchRow(1, model, haidaAdapter, index, {}, '海大');
    expect(result.status).toBe('matched');
    expect(result.method).toBe('alias');
    expect(result.product?.code).toBe(code);
  });

  it('requires confirmation again if the mapped product specification changes', () => {
    const changed = buildBrandIndex({ ...catalog, products: catalog.products.map(product =>
      product.code === 'HD501-185R14C'
        ? { ...product, spec: '185R14C 8PR 102/100S HD501' } : product,
    ) }, haidaAdapter);
    const result = matchRow(1, 'HAIDA 185R14C 8PR 102/100R EV HD501', haidaAdapter, changed, {}, '海大');
    expect(result.status).not.toBe('matched');
    expect(result.product).toBeUndefined();
  });

  it.each([
    'HAIDA 185R14C 8PR 102/100S EV HD501',
    'HAIDA 235/45ZR20 100W XL HD937EV',
    'HAIDA 245/60R18 105H HI-SPIRIT',
  ])('keeps variant differences or missing sizes for review: %s', model => {
    const result = matchRow(1, model, haidaAdapter, index, {}, '海大');
    expect(result.parsed).not.toBeNull();
    expect(result.status).not.toBe('matched');
    expect(result.product).toBeUndefined();
  });
});
