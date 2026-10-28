import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildTriangleImport, matchTriangle, readTriangleWorkbook, triangleDescriptionDifferences,
  triangleMemoryKey, triangleRows, triangleSelectableProducts, TRIANGLE_SUPPLIER,
} from '../src/brands/triangle/inbound';
import type { TriangleDecision, TriangleMemories, TriangleRow } from '../src/brands/triangle/inbound';
import { createImportWorkbook } from '../src/core/excel';
import type { Catalog, Product } from '../src/core/types';

const product: Product = { code: 'CBCTR92819F15DH0', name: '轮胎(三角)', spec: '195/70R15C(TR928)104/102S 三角', brand: '三角', unit: '条' };
const row: TriangleRow = { rowNumber: 2, model: product.code, description: '195/70R15C(TR928)104/102S 三角配套',
  date: '2026-10-18', qty: 200, price: 218, unit: '', brand: '三角', source: {} };
const catalogOf = (...products: Product[]): Catalog => ({ version: 'test', generatedAt: '', products });
const catalog = catalogOf(product);
function fileOf(rows: unknown[][]) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'triangle.xlsx');
}

describe('isolated Triangle product-code workflow', () => {
  it('detects actual Triangle headers and uses price directly, retaining repeated order lines and dates', async () => {
    const book = await readTriangleWorkbook(fileOf([
      ['销售订单'], ['车牌号', '产品', '产品描述', '数量', '价格', '产品政策', '发货日期'],
      ['', product.code, row.description, 200, 218, '配套', '2026-10-18'],
      ['', product.code, row.description, 3, 220, '新能源', '2026-10-19'],
    ]));
    expect(book.mapping.code).toBe('产品'); expect(book.mapping.price).toBe('价格');
    const rows = triangleRows(book, book.mapping);
    expect(rows.map(r => [r.rowNumber, r.qty, r.price, r.date])).toEqual([[3, 200, 218, '2026-10-18'], [4, 3, 220, '2026-10-19']]);
    const result = rows.map(r => matchTriangle(r, catalog));
    const output = buildTriangleImport(result, {}, catalog);
    expect(output).toHaveLength(2); expect(output[0]).toMatchObject({ supplier: TRIANGLE_SUPPLIER, code: product.code, qty: 200, price: 218, unit: '条' });
    const sheet = createImportWorkbook(output).Sheets.Sheet1;
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
      ['供应商', '商品编号', '商品名称', '规格', '单位', '数量', '单价'],
      [TRIANGLE_SUPPLIER, product.code, product.name, product.spec, '条', 200, 218],
      [TRIANGLE_SUPPLIER, product.code, product.name, product.spec, '条', 3, 220],
    ]);
  });
  it('matches normalized exact codes but never fuzzy-matches suffixes, spaces inside a code, or missing digits', () => {
    expect(matchTriangle({ ...row, model: ` ${product.code.toLowerCase()} ` }, catalog).status).toBe('matched');
    for (const code of [product.code + 'PF12', product.code.slice(0, -1), 'CBCTR 92819F15DH0']) {
      expect(matchTriangle({ ...row, model: code }, catalog).product).toBeUndefined();
    }
  });
  it('blocks duplicate normalized catalog codes even when a remembered mapping exists', () => {
    const duplicate = catalogOf(product, { ...product, code: product.code.toLowerCase() });
    const memories: TriangleMemories = { [triangleMemoryKey(row)]: { product, sourceCode: row.model, description: row.description } };
    expect(matchTriangle(row, duplicate, memories)).toMatchObject({ status: 'blocked', canChoose: false });
    expect(triangleSelectableProducts(duplicate)).toHaveLength(0);
  });
  it('rejects other brands and incomplete catalog data', () => {
    expect(matchTriangle(row, catalogOf({ ...product, brand: '海大' })).status).toBe('blocked');
    expect(matchTriangle(row, catalogOf({ ...product, unit: '' })).status).toBe('blocked');
    expect(triangleSelectableProducts(catalogOf(product, { ...product, code: 'OTHER', brand: '海大' }))).toEqual([product]);
  });
  it.each([
    '205/70R15C(TR928)104/102S 三角', '195/70R15C(TR929)104/102S 三角',
    '195/70R15C(TR928 PRO)104/102S 三角', '195/70R15C(TR928 PLUS)104/102S 三角',
    '195/70R15C(TR928)104/102Q 三角',
  ])('requires review for a known code with description difference: %s', description => {
    expect(matchTriangle({ ...row, description }, catalog)).toMatchObject({ status: 'review', candidate: product });
    expect(triangleDescriptionDifferences(description, product.spec).length).toBeGreaterThan(0);
  });
  it('blocks rows with blank codes or invalid numeric cells without silently dropping them', async () => {
    const book = await readTriangleWorkbook(fileOf([
      ['产品', '产品描述', '数量', '价格'], ['', row.description, 2, 218], [product.code, row.description, 0, 218],
      [product.code, row.description, 1.5, 218], [product.code, row.description, 3, ''], [product.code, row.description, 3, -1],
    ]));
    const rows = triangleRows(book, book.mapping);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      const result = matchTriangle(r, catalog);
      expect(result.status).toBe('blocked'); expect(result.canChoose).toBe(false);
      expect(() => buildTriangleImport([result], { [r.rowNumber]: { kind: 'product', product } }, catalog)).toThrow();
    }
  });
  it('rejects duplicate headers and overlapping field mappings', async () => {
    await expect(readTriangleWorkbook(fileOf([['产品', '数量', '价格', '价格'], [product.code, 1, 2, 3]]))).rejects.toThrow('重复');
    const book = await readTriangleWorkbook(fileOf([['产品', '数量', '价格'], [product.code, 1, 2]]));
    expect(() => triangleRows(book, { ...book.mapping, qty: '价格' })).toThrow('同一列');
  });
  it('requires explicit handling for every selected row and retains separate skip/new dispositions', () => {
    const results = [matchTriangle(row, catalog), matchTriangle({ ...row, rowNumber: 3, model: 'MISSING' }, catalog)];
    expect(() => buildTriangleImport(results, {}, catalog)).toThrow('尚未处理');
    for (const kind of ['skip', 'new'] as const) expect(buildTriangleImport(results, { 3: { kind } }, catalog)).toHaveLength(1);
  });
  it('reuses only same-description, current Triangle memories and invalidates changed targets', () => {
    const unknown = { ...row, model: 'FACTORY-NEW-CODE' };
    const memories: TriangleMemories = { [triangleMemoryKey(unknown)]: { sourceCode: unknown.model, description: unknown.description, product } };
    expect(matchTriangle(unknown, catalog, memories).status).toBe('matched');
    expect(matchTriangle({ ...unknown, description: row.description + ' PRO' }, catalog, memories).status).toBe('review');
    expect(matchTriangle(unknown, catalogOf({ ...product, spec: product.spec + ' PLUS' }), memories).status).toBe('review');
    const reviewed = matchTriangle(unknown, catalog, memories);
    expect(() => buildTriangleImport([reviewed], {}, catalogOf({ ...product, spec: 'changed' }))).toThrow('目录发生变化');
  });
});

const fixture = process.env.TRIANGLE_TEST_WORKBOOK ?? '文档/三角销售订单.xlsx';
describe.skipIf(!existsSync(fixture))('local Triangle source workbook (never committed)', () => {
  it('reconciles 41 rows, 2241 tires and 634941 gross amount with exact-code coverage', async () => {
    const book = await readTriangleWorkbook(new File([readFileSync(fixture)], '销售订单-已发货(6).xlsx'));
    const rows = triangleRows(book, book.mapping);
    const realCatalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog;
    expect(rows).toHaveLength(41);
    expect(new Set(rows.map(r => r.model)).size).toBe(39);
    expect(new Set(rows.map(r => r.date)).size).toBe(5);
    expect(rows.reduce((sum, r) => sum + r.qty, 0)).toBe(2241);
    expect(rows.reduce((sum, r) => sum + r.qty * r.price, 0)).toBe(634941);
    const results = rows.map(r => matchTriangle(r, realCatalog));
    const missing = rows.filter(row => !row.validationErrors?.length && !realCatalog.products.some(p => p.code.trim().toUpperCase() === row.model.trim().toUpperCase()));
    expect(results.filter(r => r.reason.startsWith('未找到该产品编号')).map(r => r.row.model)).toEqual(missing.map(r => r.model));
    // The supplied order contains a zero-price line; it must be blocked, not silently imported.
    expect(results.filter(r => r.status === 'blocked').map(r => [r.row.model, r.row.price]))
      .toEqual([['CBCTR92817F14CM0', 0]]);
    const decisions: Record<number, TriangleDecision> = {};
    for (const result of results) if (result.status !== 'matched') decisions[result.row.rowNumber] = { kind: 'skip' };
    const output = buildTriangleImport(results, decisions, realCatalog);
    expect(output.length).toBeGreaterThan(0);
    expect(output.every(r => r.supplier === TRIANGLE_SUPPLIER)).toBe(true);
    console.log(JSON.stringify({ sourceRows: rows.length, importable: output.length,
      review: results.filter(r => r.status === 'review').length, blocked: results.filter(r => r.status === 'blocked').length,
      exportQuantity: output.reduce((n, r) => n + r.qty, 0), exportAmount: output.reduce((n, r) => n + r.qty * r.price, 0) }));
  });
});
