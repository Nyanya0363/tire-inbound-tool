import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildImportRows, createImportWorkbook, createNewProductWorkbook, createReportWorkbook } from '../src/core/excel';
import type { ExportRow, MatchTrace } from '../src/core/types';

const rows: ExportRow[] = [
  {
    supplier: '四川海大轮胎橡胶集团股份有限公司',
    code: 'HD517-165R14LT',
    name: '轮胎(海大)',
    spec: '165R14LT8PR HD517 96/95Q',
    unit: '件',
    qty: 63,
    price: 137.87235,
  },
];

describe('output workbooks', () => {
  it('excludes marked new products even if an old resolved entry still exists', () => {
    const source = [
      { rowNumber: 2, model: '165R14LT HD517', brand: '海大', unit: '条', qty: 2, price: 100, source: {} },
      { rowNumber: 32, model: 'HAIDA 245/60R18 105H HI-SPIRIT', brand: '海大', unit: '条', qty: 4, price: 281.7441, source: {} },
    ];
    const resolved = new Map(source.map(row => [row.rowNumber, { code: 'SKU1', name: '轮胎', spec: '165R14LT HD517', unit: '条' }]));
    const exported = buildImportRows(source, resolved, '供应商', new Set([32]));
    expect(exported).toHaveLength(1);
    expect(exported[0].qty).toBe(2);
    const wb = createNewProductWorkbook([source[1]], '供应商', '底价');
    const roundtrip = XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const data = XLSX.utils.sheet_to_json<unknown[]>(roundtrip.Sheets[roundtrip.SheetNames[0]], { header: 1 });
    expect(data[1]).toEqual([32, '供应商', '海大', source[1].model, '条', 4, 281.7441, '底价', '待新建商品',
      '人工核对后回业务系统新建商品，更新商品目录后重新匹配；本行未写入入库导入模板。']);
    expect(data[0]).not.toContain('商品编号');
  });

  it('writes a readable xls import file with the fixed headers', () => {
    const wb = createImportWorkbook(rows);
    const data = XLSX.write(wb, { type: 'array', bookType: 'xls' });
    const read = XLSX.read(data, { type: 'array' });
    const sheet = read.Sheets[read.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    expect(aoa[0]).toEqual(['供应商', '商品编号', '商品名称', '规格', '单位', '数量', '单价']);
    expect(aoa[1][1]).toBe('HD517-165R14LT');
    expect(aoa[1][5]).toBe(63);
  });

  it('writes a matching report with the diagnostic fields', () => {
    const trace: MatchTrace = {
      rowNumber: 4,
      rawModel: 'HAIDA 175R14LT 6PR 94/92R HD517',
      parsed: {
        brand: '海大',
        pattern: 'HD517',
        size: '175R14LT',
        ply: '6PR',
        loadSpeed: '94/92R',
        flags: [],
        raw: 'HAIDA 175R14LT 6PR 94/92R HD517',
      },
      exactKey: '海大|HD517|175R14LT|6PR|94/92R|',
      coreKey: '海大|HD517|175R14LT|6PR',
      sizePatternKey: '海大|HD517|175R14LT',
      exactCount: 0,
      coreCount: 0,
      result: 'review',
      method: 'candidate',
      reason: '找到同花纹同规格商品，但层级或载重速度不一致，不能自动匹配',
      candidates: [
        { code: 'HD517-175R14LT', spec: '175R14LT8PRHD517 99/97R', score: 50, reason: '同花纹同规格' },
      ],
    };
    const wb = createReportWorkbook([trace], 'test-version');
    const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const read = XLSX.read(data, { type: 'array' });
    const sheet = read.Sheets[read.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    expect(aoa[0]).toContain('候选商品');
    expect(aoa[1][1]).toBe('HAIDA 175R14LT 6PR 94/92R HD517');
    expect(aoa[1][7]).toBe('待确认');
  });
});
