import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import { rememberAlias } from '../src/core/aliases';
import type { Catalog } from '../src/core/types';

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog;
const index = buildBrandIndex(catalog, haidaAdapter);

describe('real catalog model variations', () => {
  it.each([
    ['HAIDA 11R22.5 16PR 146/143M HD158', 'HTQG45'],
    ['HAIDA 295/80R22.5 18PR 152/149M HD158', 'HTQG60'],
    ['HAIDA 235/55R17 103V RUNSPIRIT', 'Runspirit-235/55R17'],
    ['ＨＡＩＤＡ　１１Ｒ２２．５（１６）ＨＤ１５８　１４６／１４３Ｍ', 'HTQG45'],
    ['HAIDA 31×10.50R15LT 6PR 109Q HD818', 'HD818-31×10.5R15LT'],
  ])('normalizes model fields without reading SKU: %s', (model, code) => {
    const result = matchRow(1, model, haidaAdapter, index, {});
    expect(result.status).toBe('matched');
    expect(result.product?.code).toBe(code);
    expect(result.parsed?.unrecognized).toBeUndefined();
  });

  it('recognizes spaced brand, pattern and load/speed tokens for Tianfu', () => {
    const result = matchRow(1, 'TIANFU 235 / 60 R 17 106 H XL HI SPIRIT', haidaAdapter, index, {});
    expect(result.status).toBe('matched');
    expect(result.product?.code).toBe('HI-SPIRIT-235/60R17');
  });

  it('recognizes the aspect ratio separated by whitespace', () => {
    const result = matchRow(1, 'TIANFU 235 60 R17 106H XL HI-SPIRIT', haidaAdapter, index, {});
    expect(result.parsed?.size).toBe('235/60R17');
    expect(result.status).toBe('matched');
    expect(result.product?.code).toBe('HI-SPIRIT-235/60R17');
  });

  it('requires review when the explicit brand column contradicts the model', () => {
    const result = matchRow(1, 'HAIDA 235/60R17 106H XL HI-SPIRIT', haidaAdapter, index, {}, '天府');
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
    expect(result.reason).toContain('品牌列');
  });

  it.each(['HAIDA 185R14LT 8PR 102/100R HD501', 'HAIDA 255/45R20 105W XL HD937'])('does not erase size suffix differences: %s', model => {
    const target = model.includes('HD501') ? 'HD501-185R14C' : 'HD937-H255/45ZR20XL';
    const result = matchRow(1, model, haidaAdapter, index, {});
    expect(result.product?.code).not.toBe(target);
  });

  it('parses HDA patterns and a dash-form ply without guessing load/speed', () => {
    expect(haidaAdapter.parseInbound('HAIDA 10.00R20-18 HDA68')).toMatchObject({ size: '10.00R20', ply: '18PR', pattern: 'HDA68' });
    expect(haidaAdapter.parseInbound('HAIDA 10.00R20-18 HDA68').loadSpeed).toBeUndefined();
  });

  it('preserves the full rim diameter and does not merge 22 and 22.5', () => {
    const parsed = haidaAdapter.parseInbound('HAIDA 11R22.5 16PR 146/143M HD158');
    expect(parsed.size).toBe('11R22.5');
    const result = matchRow(1, 'HAIDA 11R22 16PR 146/143M HD158', haidaAdapter, index, {});
    expect(result.product).toBeUndefined();
  });

  it('does not merge a different ply or named pattern', () => {
    expect(matchRow(1, 'HAIDA 11R22.5 18PR 146/143M HD158', haidaAdapter, index, {}).status).not.toBe('matched');
    const result = matchRow(1, 'HAIDA 245/60R18 105H HI-SPIRIT', haidaAdapter, index, {});
    expect(result.status).toBe('unmatched');
    expect(result.candidates.every(candidate => index.parsedProducts.get(candidate.product.code)?.pattern === 'HI-SPIRIT')).toBe(true);
    expect(result.candidates.some(candidate => candidate.product.code === 'HD837-H245/60R18')).toBe(false);
  });

  it('does not let an old saved association bypass a different pattern', () => {
    const model = 'HAIDA 245/60R18 105H HI-SPIRIT';
    const wrong = index.byCode.get('HD837-H245/60R18')!;
    const result = matchRow(1, model, haidaAdapter, index, { [model]: rememberAlias(model, wrong, haidaAdapter) });
    expect(result.status).not.toBe('matched');
    expect(result.product).toBeUndefined();
    expect(result.candidates).toHaveLength(0);
  });
});
