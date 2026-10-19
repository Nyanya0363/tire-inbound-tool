import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { haidaAdapter as adapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow } from '../src/core/matcher';
import { analyzeInboundRows, buildImportRows, createImportWorkbook, readInboundWorkbook, validateInboundRow } from '../src/core/excel';
import { forgetAlias, rememberAlias } from '../src/core/aliases';
import { pendingRows, resolveResult } from '../src/core/workflow';

const model = 'HAIDA 165R14LT 8PR 96/95Q HD517';
const product = { code: 'SKU1', spec: '165R14LT 8PR 96/95Q HD517', name: '轮胎', brand: '海大', unit: '条' };
const index = buildBrandIndex({ version: 'test', generatedAt: '', products: [product] }, adapter);
const row = { rowNumber: 2, model, qty: 2, price: 100, brand: '海大', unit: '条', source: {} };

async function readRows(qty: unknown, price: unknown) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['规格', '数量', '价格', '底价'], [model, qty, 120, price]]), '订单');
  const file = new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'test.xlsx');
  return readInboundWorkbook(file, adapter);
}

describe('order decisions and export', () => {
  it('uses the selected price column through an actual Excel round trip', async () => {
    const wb = await readRows(2, 95.125);
    for (const [field, price] of [['价格', 120], ['底价', 95.125]] as const) {
      const rows = analyzeInboundRows(wb, { ...wb.mapping, price: field }, '海大').rows;
      const exported = buildImportRows(rows, new Map([[2, product]]), adapter.supplierName);
      const output = createImportWorkbook(exported);
      const parsed = XLSX.read(XLSX.write(output, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
      const cells = XLSX.utils.sheet_to_json<unknown[]>(parsed.Sheets.Sheet1, { header: 1 });
      expect(cells[1][6]).toBe(price);
    }
  });

  it.each(['', 'abc', '1,2', true, 'Infinity'])('preserves invalid numeric input as an error: %s', async value => {
    const wb = await readRows(value, 100);
    const invalid = analyzeInboundRows(wb, wb.mapping, '海大').rows[0];
    expect(Number.isNaN(invalid.qty)).toBe(true);
    expect(invalid.validationErrors?.join()).toContain('数量');
    expect(invalid.validationErrors?.join()).not.toContain('超出有效范围');
    const result = resolveResult(matchRow(2, model, adapter, index, {}), invalid, index, 'SKU1', true);
    expect(result.status).toBe('review');
    expect(result.product).toBeUndefined();
    expect(() => buildImportRows([invalid], new Map([[2, product]]), '供应商')).toThrow('不能导出');
  });

  it('accepts fullwidth and valid thousands notation without rounding purchase prices', async () => {
    const wb = await readRows('１，０００', '￥１２３．４５６７');
    const parsed = analyzeInboundRows(wb, wb.mapping, '海大').rows[0];
    expect(parsed.qty).toBe(1000);
    expect(parsed.price).toBe(123.4567);
    expect(validateInboundRow(parsed)).toEqual([]);
  });

  it.each([{ qty: 0 }, { qty: -1 }, { qty: 1.5 }, { price: 0 }, { price: -10 }, { price: NaN }])(
    'rejects invalid quantities and prices even with an existing selection: %j', changes => {
      const invalid = { ...row, ...changes };
      expect(resolveResult(matchRow(2, model, adapter, index, {}), invalid, index, 'SKU1', true).status).toBe('review');
      expect(() => buildImportRows([invalid], new Map([[2, product]]), '供应商')).toThrow();
      expect(buildImportRows([invalid], new Map([[2, product]]), '供应商', new Set([2]))).toEqual([]);
    });

  it('keeps core matches pending in both engine and report until confirmation', () => {
    const raw = model + ' XL';
    const result = matchRow(2, raw, adapter, index, {});
    expect(result.status).toBe('review');
    expect(result.trace.result).toBe('review');
    expect(result.trace.matchedCode).toBeUndefined();
    const confirmed = resolveResult(result, row, index, undefined, true);
    expect(confirmed.status).toBe('matched');
    expect(confirmed.trace.result).toBe('matched');
    expect(resolveResult(result, row, index).status).toBe('review');
  });

  it('requires an explicit decision for every unresolved row and restores it when cancelled', () => {
    const missing = matchRow(2, '165R14LT 8PR 96/95Q HD999', adapter, index, {});
    expect(pendingRows([missing], {}, {})).toBe(1);
    for (const disposition of ['new', 'skip'] as const) {
      const resolved = resolveResult(missing, row, index, undefined, false, disposition);
      expect(resolved.product).toBeUndefined();
      expect(resolved.trace.matchedCode).toBeUndefined();
      expect(resolved.reason).toContain(disposition === 'new' ? '待新建' : '跳过');
      expect(pendingRows([resolved], disposition === 'new' ? { 2: true } : {}, disposition === 'skip' ? { 2: true } : {})).toBe(0);
    }
    expect(pendingRows([resolveResult(missing, row, index)], {}, {})).toBe(1);
  });

  it('revokes equivalent model memories as well as the exact raw key', () => {
    const raw = model + ' XL';
    const parsed = adapter.parseInbound(raw);
    const memory = {
      [raw]: rememberAlias(raw, product, adapter),
      ['HD517 165R14LT 8PR 96/95Q XL']: rememberAlias(raw, product, adapter),
      OTHER: rememberAlias('175R14LT 8PR 99/97R HD517', product, adapter),
    };
    expect(matchRow(2, raw, adapter, index, memory).method).toBe('alias');
    const revoked = forgetAlias(raw, parsed, memory);
    expect(Object.keys(revoked)).toEqual(['OTHER']);
    expect(matchRow(2, raw, adapter, index, revoked).status).toBe('review');
  });
});
