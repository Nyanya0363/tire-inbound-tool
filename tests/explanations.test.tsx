import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as XLSX from 'xlsx';
import { haidaAdapter as adapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import { comparisonExplanations, explainMatch, formatExplanations } from '../src/core/explanations';
import { createReportWorkbook } from '../src/core/excel';
import { resolveResult } from '../src/core/workflow';
import { diffTire } from '../src/core/diff';
import { DiffDialog } from '../src/components/DiffDialog';
import type { Catalog, Product } from '../src/core/types';

// Freeze the historical incomplete specs; maintaining the live catalog must not erase regression cases.
const catalog = JSON.parse(readFileSync('tests/fixtures/haida-baseline.json', 'utf8')) as Catalog;
const index = buildBrandIndex(catalog, adapter);
const model = 'HAIDA LT275/60R20 10PR 123/120Q HD877 Pro';
const product = (code: string, spec: string): Product => ({ code, spec, name: '轮胎', brand: '海大', unit: '条' });
const indexOf = (products: Product[]) => buildBrandIndex({ version: 'test', generatedAt: '', products }, adapter);

describe('shared review explanations', () => {
  it('retains HD877 raw 123 and explains white-letter and Pro differences without declaring a new product', () => {
    const result = matchRow(2, model, adapter, index, {});
    const reasons = result.candidates.find(c => c.product.code === 'HD877-LT275/60R20')!.explanations!;
    expect(result.status).toBe('review');
    expect(reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unrecognized', side: 'product', message: expect.stringContaining('123') }),
      expect.objectContaining({ code: 'parameter_difference', field: 'flag:WHITE' }),
      expect.objectContaining({ code: 'parameter_difference', field: 'flag:PRO' }),
    ]));
    expect(reasons.some(item => item.code === 'field_missing' && item.field === 'loadSpeed' && item.side === 'product')).toBe(false);
    expect(result.explanations?.some(item => item.code === 'not_found')).toBe(false);
    expect(result.trace.explanations).toEqual(result.explanations);
    expect(result.trace.candidates[0].explanations).toEqual(result.candidates[0].explanations);
  });

  it.each([8, 10])('shows EV and every additional parameter difference for %sPR', ply => {
    const idx = indexOf([product('SKU', `165R14LT ${ply}PR 96/95Q HD665`)]);
    const result = matchRow(1, '165R14LT 8PR 96/95Q HD665EV', adapter, idx, {});
    expect(result.status).toBe('review');
    expect(result.explanations).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'ev_difference' })]));
    expect(result.explanations?.some(item => item.code === 'parameter_difference' && item.field === 'ply')).toBe(ply !== 8);
    expect(formatExplanations(result.explanations)).not.toContain('仅 EV');
  });

  it('explains duplicate exact SKUs without reporting a missing product', () => {
    const spec = '165R14LT 8PR 96/95Q HD517';
    const result = matchRow(1, spec, adapter, indexOf([product('A', spec), product('B', spec)]), {});
    expect(result.status).toBe('review');
    expect(result.explanations?.map(item => item.code)).toEqual(['multiple_matches']);
    expect(formatExplanations(result.explanations)).toContain('2 个商品编号');
  });

  it('distinguishes not found from parse failure', () => {
    const absent = matchRow(1, '245/60R18 105H HI-SPIRIT', adapter, indexOf([]), {});
    expect(absent.explanations?.map(item => item.code)).toEqual(['not_found']);
    const unknown = matchRow(1, '厂家特殊型号甲', adapter, indexOf([]), {});
    expect(unknown.explanations?.map(item => item.code)).toEqual(['parse_error']);
  });

  it('distinguishes a missing field from an unrecognized partial value', () => {
    const source = adapter.parseInbound('165R14LT 8PR 96/95Q HD517');
    const blank = adapter.parseInbound('165R14LT 8PR HD517');
    const partial = adapter.parseInbound('165R14LT 8PR 96 HD517');
    expect(comparisonExplanations(source, blank)).toContainEqual(expect.objectContaining({ code: 'field_missing', field: 'loadSpeed', side: 'product' }));
    expect(comparisonExplanations(source, partial)).toContainEqual(expect.objectContaining({ code: 'unrecognized', field: 'loadSpeed', side: 'product' }));
  });

  it('includes SKU and explicit brand conflicts', () => {
    const wrong = product('HD718-165R14LT', '165R14LT 8PR 96/95Q HD517');
    expect(matchRow(1, wrong.spec, adapter, indexOf([wrong]), {}).explanations).toContainEqual(expect.objectContaining({ code: 'data_conflict', message: expect.stringContaining('SKU') }));
    expect(matchRow(1, 'MILEKING 165R14LT 8PR 96/95Q HD517', adapter, indexOf([product('A', wrong.spec)]), {}, '海大').explanations).toContainEqual(expect.objectContaining({ code: 'data_conflict', side: 'manufacturer' }));
  });

  it('keeps numeric problems separate and clears old reasons when explicitly skipped', () => {
    const base = matchRow(2, model, adapter, index, {});
    const row = { rowNumber: 2, model, qty: NaN, price: 499, brand: '海大', unit: '条', source: {} };
    const invalid = resolveResult(base, row, index);
    expect(invalid.explanations?.every(item => item.code === 'numeric_error')).toBe(true);
    expect(invalid.trace.explanations).toEqual(invalid.explanations);
    expect(resolveResult(base, row, index, undefined, false, 'skip').explanations).toEqual([]);
  });

  it('writes the exact same structured messages to the report and supports old traces', () => {
    const result = matchRow(2, model, adapter, index, {});
    const wb = createReportWorkbook([result.trace], catalog.version);
    const saved = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const data = XLSX.utils.sheet_to_json<unknown[]>(saved.Sheets['匹配报告'], { header: 1 });
    expect(data[1][10]).toBe(formatExplanations(result.explanations));
    expect(data[1][11]).toContain(formatExplanations(result.candidates[0].explanations));
    const old = { ...result.trace, explanations: undefined, candidates: [] };
    const oldWb = createReportWorkbook([old], 'old');
    expect(XLSX.utils.sheet_to_json<unknown[]>(oldWb.Sheets['匹配报告'], { header: 1 })[1][10]).toBe(old.reason);
  });

  it('adds metadata without changing matching decisions or candidate order', () => {
    const base = matchRow(2, model, adapter, index, {});
    const enriched = explainMatch(base, index.parsedProducts);
    expect(enriched.status).toBe(base.status);
    expect(enriched.method).toBe(base.method);
    expect(enriched.product).toBe(base.product);
    expect(enriched.candidates.map(c => [c.product.code, c.score])).toEqual(base.candidates.map(c => [c.product.code, c.score]));
    expect(JSON.parse(JSON.stringify(enriched)).trace.explanations).toEqual(enriched.explanations);
  });

  it('renders a read-only candidate comparison with all fields and explicit selection', () => {
    const result = matchRow(2, model, adapter, index, {});
    const candidate = result.candidates[0];
    const target = index.parsedProducts.get(candidate.product.code)!;
    const html = renderToStaticMarkup(<DiffDialog open rawModel={model} productCode={candidate.product.code}
      productSpec={candidate.product.spec} diff={diffTire(result.parsed!, target)} manufacturer={result.parsed!}
      product={target} explanations={candidate.explanations} candidate confirmed={false}
      onConfirm={() => { throw Error('Rendering must not confirm'); }} onReselect={() => {}} onClose={() => {}} />);
    for (const label of ['品牌', '花纹', '规格', '层级', '载重速度', '附加标识', '123', '未提供', '选择此商品', '查看和关闭不会确认']) expect(html).toContain(label);
    expect(html).not.toContain('确认使用此商品');
  });
});
