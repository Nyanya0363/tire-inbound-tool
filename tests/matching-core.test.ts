import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import { rememberAlias } from '../src/core/aliases';
import type { Catalog, Product } from '../src/core/types';

function product(code: string, spec: string): Product {
  return { code, spec, name: '轮胎（海大）', brand: '海大', unit: '条' };
}
function indexOf(products: Product[]) {
  return buildBrandIndex({ version: 'test', generatedAt: '', products } as Catalog, haidaAdapter);
}

describe('specification-led matching', () => {
  it('does not choose the product with missing load speed when the source is incomplete', () => {
    const result = matchRow(1, '165R14LT 8PR HD517', haidaAdapter, indexOf([
      product('SKU1', '165R14LT 8PR HD517'), product('SKU2', '165R14LT 8PR 96/95Q HD517'),
    ]), {});
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
    expect(result.reason).toContain('载重速度');
  });

  it('does not pick one of two identical product specifications by SKU', () => {
    const result = matchRow(1, '165R14LT 8PR 96/95Q HD517', haidaAdapter, indexOf([
      product('SKU1', '165R14LT 8PR 96/95Q HD517'), product('SKU2', '165R14LT 8PR 96/95Q HD517'),
    ]), {});
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
    expect(result.candidates).toHaveLength(2);
  });

  it('does not batch-confirm a white-letter variant mismatch', () => {
    const result = matchRow(1, 'LT255/60R19 8PR 113/110Q 白字 HD877', haidaAdapter,
      indexOf([product('SKU1', 'LT255/60R19 8PR 113/110Q HD877')]), {});
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
  });

  it('uses specification fields and reports conflicting SKU fields', () => {
    const p = product('HD517-175R14LT6PR', '185R14LT 8PR 102/100S HD718');
    expect(haidaAdapter.parseProduct(p)).toMatchObject({ size: '185R14LT', pattern: 'HD718', ply: '8PR' });
    const result = matchRow(1, p.spec, haidaAdapter, indexOf([p]), {});
    expect(result.status).toBe('review');
    expect(result.reason).toContain('SKU');
    expect(result.reason).toContain('商品规格');
    expect(result.product).toBeUndefined();
  });

  it('does not fill incomplete specification fields from the SKU', () => {
    expect(haidaAdapter.parseProduct(product('HD517-165R14LT', '8PR 96/95Q'))).toBeNull();
  });

  it('treats the SKU as an identifier without adding its XL flag', () => {
    const p = product('HD937-H235/50ZR20XL', '235/50ZR20 104W HD937');
    expect(haidaAdapter.parseProduct(p)?.flags).not.toContain('XL');
  });

  it('requires individual selection for conflicting load/speed values', () => {
    const result = matchRow(1, '165R14LT 8PR 96/95Q HD517', haidaAdapter,
      indexOf([product('SKU1', '165R14LT 8PR 99/97R HD517')]), {});
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
    expect(result.candidates[0].reason).toContain('载重速度不一致');
  });

  it('offers an EV upgrade for human review before other sizes', () => {
    const result = matchRow(1, '185R14C 8PR 102/100R EV HD501', { ...haidaAdapter, confirmedMappings: [] },
      indexOf([
        product('SKU1', '185R14C 8PR 102/100R HD501'),
        product('SKU2', '185R15C 8PR 103/102R HD501EV'),
      ]), {});
    expect(result.status).toBe('review');
    expect(result.candidates.map(c => c.product.code)).toEqual(['SKU1']);
    expect(result.candidates[0].reason).toContain('花纹不一致');
    expect(result.candidates[0].reason).toContain('HD501EV');
    expect(result.reason).toContain('仅 EV 后缀不同');
    expect(result.product).toBeUndefined();
  });

  it('reuses an EV association only after human confirmation', () => {
    const model = '185R14C 8PR 102/100R EV HD501';
    const adapter = { ...haidaAdapter, confirmedMappings: [] };
    const target = product('SKU1', '185R14C 8PR 102/100R HD501');
    const index = indexOf([target]);
    expect(matchRow(1, model, adapter, index, {}).status).toBe('review');
    const result = matchRow(1, model, adapter, index, { [model]: rememberAlias(model, target, adapter) });
    expect(result.status).toBe('matched');
    expect(result.method).toBe('alias');
    expect(result.product?.code).toBe('SKU1');
  });

  it.each(['EVT', 'SP'])('does not treat %s as an EV upgrade', suffix => {
    const result = matchRow(1, `185R14C 8PR 102/100R HD501${suffix}`, haidaAdapter,
      indexOf([product('SKU1', '185R14C 8PR 102/100R HD501')]), {});
    expect(result.status).toBe('unmatched');
    expect(result.candidates).toHaveLength(0);
  });

  it('marks other sizes as auxiliary references rather than matching candidates', () => {
    const result = matchRow(1, '245/60R18 105H HI-SPIRIT', haidaAdapter,
      indexOf([product('SKU1', '225/60R18 104H HI-SPIRIT')]), {});
    expect(result.status).toBe('unmatched');
    expect(result.reason).toContain('疑似未建档');
    expect(result.candidates[0].reason).toContain('规格不一致');
  });

  it('does not silently ignore an unfamiliar descriptor', () => {
    const result = matchRow(1, '165R14LT 8PR 96/95Q HD517 特殊版', haidaAdapter,
      indexOf([product('SKU1', '165R14LT 8PR 96/95Q HD517')]), {});
    expect(result.status).toBe('review');
    expect(result.reason).toContain('特殊版');
  });
});
