import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haidaAdapter } from '../src/brands/haida/adapter';
import { buildBrandIndex, matchRow, unsupportedBrandResult } from '../src/core/matcher';
import { analyzeInboundRows, buildInboundRows, readInboundWorkbook } from '../src/core/excel';
import { normalizeBrand } from '../src/core/text';
import type { Catalog } from '../src/core/types';

const catalog = JSON.parse(readFileSync('public/catalog.json', 'utf8')) as Catalog;
const index = buildBrandIndex(catalog, haidaAdapter);

const fixtureFile = ['文档/福州怡盛10.12出库原始文件.xlsx', '福州怡盛10.12出库原始文件.xlsx']
  .find(path => existsSync(path)) ?? '福州怡盛10.12出库原始文件.xlsx';
const hasFixture = existsSync(fixtureFile);
const describeOriginal = hasFixture ? describe : describe.skip;

describeOriginal('original Fuzhou Yisheng workbook', () => {
  it('reads all three table sections and skips repeated headers/totals', async () => {
    const buffer = readFileSync(fixtureFile);
    const file = new File([buffer], fixtureFile);
    const workbook = await readInboundWorkbook(file, haidaAdapter);
    const analysis = analyzeInboundRows(workbook, workbook.mapping, haidaAdapter.label);
    const rows = analysis.rows;
    expect(workbook.headerRowIndex).toBe(1);
    expect(workbook.sectionTitles).toHaveLength(2);
    expect(workbook.sectionTitles[0].text).toContain('10.8出库');
    expect(workbook.sectionTitles[1].text).toContain('10.12出库');
    expect(rows).toHaveLength(67);
    expect(analysis.ignoredHeaderRows).toBe(1);
    expect(analysis.ignoredEmptyModelRows).toBe(3);
    expect(rows[0].model).toContain('TIANFU 145R12LT');
    expect(rows[rows.length - 1].model).toContain('HD627');
  });

  it('matches the expected baseline and keeps the known problem rows visible', async () => {
    const buffer = readFileSync(fixtureFile);
    const file = new File([buffer], fixtureFile);
    const workbook = await readInboundWorkbook(file, haidaAdapter);
    const rows = buildInboundRows(workbook, workbook.mapping, haidaAdapter.label);
    const results = rows.map((row) => {
      const isHaida = haidaAdapter.brandAliases.some(
        (alias) => normalizeBrand(alias) === normalizeBrand(row.brand),
      );
      return isHaida
        ? matchRow(row.rowNumber, row.model, haidaAdapter, index, {}, row.brand)
        : unsupportedBrandResult(row.rowNumber, row.model, row.brand);
    });

    expect(results).toHaveLength(67);
    expect(results.filter((result) => result.status === 'matched')).toHaveLength(40);
    expect(results.filter((result) => result.status === 'review')).toHaveLength(21);
    expect(results.filter(result => result.method === 'core')).toHaveLength(16);
    expect(results.filter((result) => result.status === 'unmatched')).toHaveLength(6);
    for (const rowNumber of [65, 72, 73]) {
      const result = results.find(item => item.trace.rowNumber === rowNumber);
      expect(result?.status).toBe('unmatched');
      expect(result?.reason).toContain('基础花纹不同的商品已排除');
      expect(result?.candidates.every(candidate =>
        index.parsedProducts.get(candidate.product.code)?.pattern === result.parsed?.pattern)).toBe(true);
    }
    for (const rowNumber of [10, 43, 48, 57]) {
      const result = results.find(item => item.trace.rowNumber === rowNumber);
      expect(result?.status).toBe('review');
      expect(result?.reason).toContain('未识别内容');
      expect(result?.product).toBeUndefined();
    }

    const row40 = results.find((result) => result.trace.rowNumber === 40);
    expect(row40?.status).toBe('matched');
    expect(row40?.product?.code).toBe('HD517-175R14LT94/92R');

    const row20 = results.find((result) => result.trace.rowNumber === 20);
    expect(row20?.product?.code).toBe('BH007534');
    const row21 = results.find((result) => result.trace.rowNumber === 21);
    expect(row21?.product?.code).toBe('BH007535');

    const row4 = results.find((result) => result.trace.rowNumber === 4);
    expect(row4?.product?.code).toBe('HD302-145/60R13');
    const row16 = results.find((result) => result.trace.rowNumber === 16);
    expect(row16?.product?.code).toBe('HD927-H275/35ZR20XL');

    const tianfu = results.find((result) => result.trace.rowNumber === 3);
    expect(tianfu?.product?.brand).toBe('天府');
  });
});
