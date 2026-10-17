import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildCatalogFromFile } from '../src/core/catalogBuilder';

const HEADER = [
  '商品编号',
  '商品名称',
  '规格/型号',
  '品牌',
  '单位',
  '销售价格',
  '批发价格',
  '成本价格',
  '库存数',
  '仓库',
  '库存位置',
  '备注',
  '条码',
  '商品分类',
];

function makeFile(
  sheets: Array<{ name: string; rows: unknown[][] }>,
  fileName = '商品资料.xlsx',
): File {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  const data = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return new File([data], fileName);
}

const PRODUCT_ROW = [
  'BH007456',
  '轮胎（海大）',
  '6.00R14PR HD160',
  '海大',
  '条',
  0,
  300,
  284,
  1,
  '鼓山库',
  '',
  '',
  '16060014160',
  '',
];

describe('catalog builder header detection', () => {
  it('finds a header row that is not within the first 10 rows', async () => {
    const rows = [
      ['商品资料'],
      ['导出时间：2026-10-17'],
      ...Array.from({ length: 8 }, () => []),
      HEADER,
      PRODUCT_ROW,
    ];
    const result = await buildCatalogFromFile(makeFile([{ name: '商品资料', rows }]));

    expect(result.catalog.products).toHaveLength(1);
    expect(result.catalog.products[0]).toEqual({
      code: 'BH007456',
      name: '轮胎（海大）',
      spec: '6.00R14PR HD160',
      brand: '海大',
      unit: '条',
      barcode: '16060014160',
    });
  });

  it('reads the data from a later sheet when the first sheet is a cover', async () => {
    const file = makeFile([
      { name: '封面', rows: [['商品资料'], ['请勿修改']] },
      { name: '商品清单', rows: [HEADER, PRODUCT_ROW] },
    ]);
    const result = await buildCatalogFromFile(file);

    expect(result.catalog.products.map((product) => product.code)).toEqual(['BH007456']);
  });

  it('accepts headers with extra symbols, spaces and alias names', async () => {
    const rows = [
      ['商品编码*', '商品名称', '规格（型号）', '品牌', '单位', '条形码'],
      ['A1', '轮胎甲', '165R14LT HD517', '海大', '条', '123456'],
    ];
    const result = await buildCatalogFromFile(makeFile([{ name: 'Sheet1', rows }]));

    expect(result.catalog.products[0]).toMatchObject({
      code: 'A1',
      spec: '165R14LT HD517',
      barcode: '123456',
    });
  });

  it('skips repeated header rows inside the data', async () => {
    const rows = [HEADER, PRODUCT_ROW, HEADER, ['A2', '轮胎乙', '175R14LT HD517', '海大', '条']];
    const result = await buildCatalogFromFile(makeFile([{ name: 'Sheet1', rows }]));

    expect(result.catalog.products.map((product) => product.code)).toEqual(['BH007456', 'A2']);
  });

  it('reports the detected headers when required columns are missing', async () => {
    const file = makeFile([{ name: 'Sheet1', rows: [['名称', '价格'], ['甲', 1]] }]);

    await expect(buildCatalogFromFile(file)).rejects.toThrow(
      /商品资料缺少“商品编号”或“规格\/型号”列.*名称、价格/,
    );
  });

  it('reads UTF-8 CSV files with a BOM', async () => {
    const csv =
      '﻿商品编号,商品名称,规格/型号,品牌,单位,条码\nA1,轮胎甲,165R14LT HD517,海大,条,123456\n';
    const result = await buildCatalogFromFile(new File([csv], '商品资料.csv'));

    expect(result.catalog.products).toHaveLength(1);
    expect(result.catalog.products[0].spec).toBe('165R14LT HD517');
  });

  it('repairs GBK text that was decoded as Latin-1 inside the workbook', async () => {
    const mojibakeHeader = [
      'ÉÌÆ·±àºÅ',
      'ÉÌÆ·Ãû³Æ',
      '¹æ¸ñ/ÐÍºÅ',
      'Æ·ÅÆ',
      'µ¥Î»',
      'ÏúÊÛ¼Û¸ñ',
      'Åú·¢¼Û¸ñ',
      '³É±¾¼Û¸ñ',
      '¿â´æÊý',
      '²Ö¿â',
      '¿â´æÎ»ÖÃ',
      '±¸×¢',
      'ÌõÂë',
      'ÉÌÆ··ÖÀà',
    ];
    const mojibakeProduct = [
      'A1',
      'ÂÖÌ¥¼×',
      '165R14LT HD517',
      'º£´ó',
      'Ìõ',
      '0',
      '300',
      '284',
      '1',
      '¹ÄÉ½¿â',
      '',
      '',
      '123456',
      '',
    ];
    const file = makeFile([
      { name: 'Sheet1', rows: [mojibakeHeader, mojibakeProduct] },
    ]);
    const result = await buildCatalogFromFile(file);

    expect(result.catalog.products[0]).toEqual({
      code: 'A1',
      name: '轮胎甲',
      spec: '165R14LT HD517',
      brand: '海大',
      unit: '条',
      barcode: '123456',
    });
  });

  it('detects a GBK CSV even when it is named .xls', async () => {
    const hex =
      'C9CCC6B7B1E0BAC52CC9CCC6B7C3FBB3C62CB9E6B8F12FD0CDBAC52CC6B7C5C62CB5A5CEBB2CCCF5C2EB0A' +
      '41312CC2D6CCA5BCD72C3136355231344C542048443531372CBAA3B4F32CCCF52C3132333435360A';
    const bytes = Uint8Array.from(
      hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? [],
    );
    const file = new File([bytes], '商品资料.xls');

    const result = await buildCatalogFromFile(file);

    expect(result.catalog.products[0]).toEqual({
      code: 'A1',
      name: '轮胎甲',
      spec: '165R14LT HD517',
      brand: '海大',
      unit: '条',
      barcode: '123456',
    });
  });
});
