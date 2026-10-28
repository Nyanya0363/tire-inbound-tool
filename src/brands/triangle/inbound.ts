import * as XLSX from 'xlsx';
import type { Catalog, ExportRow, Product, RawInboundRow } from '../../core/types';
import { buildImportRows, validateInboundRow } from '../../core/excel';

export const TRIANGLE_SUPPLIER = '三角轮胎股份有限公司';
export const TRIANGLE_HEADERS = ['产品', '产品描述', '数量', '价格', '发货日期', '车牌号', '销售订单号'];
export interface TriangleMapping { code: string; description: string; qty: string; price: string; date: string }
export interface TriangleWorkbook {
  fileName: string; sheetName: string; sheetCount: number; headers: string[];
  rows: Array<{ rowNumber: number; cells: Record<string, unknown> }>; mapping: TriangleMapping;
}
export interface TriangleRow extends RawInboundRow { description: string; date: string }
export type TriangleDecision = { kind: 'skip' };
export interface TriangleResult {
  row: TriangleRow; status: 'matched' | 'new' | 'blocked'; reason: string;
  product?: Product;
}

export const normalizeCode = (code: string) => code.normalize('NFKC').trim().toUpperCase();
export const isTriangle = (product: Product) => ['三角', 'TRIANGLE'].includes(normalizeCode(product.brand));
const headerText = (value: unknown) => String(value ?? '').replace(/[\s：:（）()]/g, '');
const aliases: Record<keyof TriangleMapping, string[]> = {
  code: ['产品', '产品编号', '商品编号'], description: ['产品描述', '商品规格', '规格'],
  qty: ['数量'], price: ['价格', '单价'], date: ['发货日期'],
};

export async function readTriangleWorkbook(file: File): Promise<TriangleWorkbook> {
  const book = file.name.toLowerCase().endsWith('.csv')
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = book.SheetNames[0];
  if (!sheetName) throw new Error('文件中没有工作表');
  const data = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[sheetName], { header: 1, defval: '', raw: true });
  const headerIndex = data.slice(0, 20).findIndex(row => {
    const cells = row.map(headerText);
    return (['code', 'qty', 'price'] as const).every(key => aliases[key].some(alias => cells.includes(alias)));
  });
  if (headerIndex < 0) throw new Error('未找到三角表头，请保留“产品、数量、价格”列，产品描述可选且不参与匹配。');
  const rawHeaders = data[headerIndex].map(value => String(value ?? '').trim());
  const headers = rawHeaders.filter(Boolean);
  if (new Set(headers.map(headerText)).size !== headers.length) throw new Error('表头有重复列名，请修改后重新上传，避免取错数量或价格。');
  const mapping = Object.fromEntries(Object.entries(aliases).map(([key, names]) =>
    [key, names.map(name => headers.find(header => headerText(header) === name)).find(Boolean) ?? ''])) as unknown as TriangleMapping;
  const rows = data.slice(headerIndex + 1).flatMap((row, offset) => {
    const cells = Object.fromEntries(rawHeaders.flatMap((header, i) => header ? [[header, row[i] ?? '']] : []));
    if (!Object.values(cells).some(value => String(value).trim())) return [];
    if (headerText(cells[mapping.code]) === headerText(mapping.code)
      && headerText(cells[mapping.qty]) === headerText(mapping.qty)) return [];
    // Do not silently drop rows with missing product codes or invalid quantities.
    return [{ rowNumber: headerIndex + offset + 2, cells }];
  });
  if (!rows.length) throw new Error('表格没有商品行');
  return { fileName: file.name, sheetName, sheetCount: book.SheetNames.length, headers, rows, mapping };
}

function numeric(value: unknown): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').normalize('NFKC').trim().replace(/^[￥¥]\s*/, '').replace(/\s*元$/, '');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d*)?)$/.test(text)
    ? Number(text.replace(/,/g, '')) : NaN;
}

function dateText(value: unknown): string {
  if (typeof value === 'number') {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
  }
  return String(value ?? '').trim() || '未填写';
}

export function triangleRows(book: TriangleWorkbook, mapping: TriangleMapping): TriangleRow[] {
  const required = [mapping.code, mapping.qty, mapping.price];
  if (required.some(header => !header || !book.headers.includes(header))) throw new Error('请选择产品编号、数量和单价列');
  const assigned = Object.values(mapping).filter(Boolean);
  if (new Set(assigned).size !== assigned.length) throw new Error('不同字段不能映射到同一列');
  return book.rows.map(({ rowNumber, cells }) => {
    const model = String(cells[mapping.code] ?? '').trim();
    const row: TriangleRow = { rowNumber, model, description: String(cells[mapping.description] ?? '').trim(),
      date: dateText(cells[mapping.date]), qty: numeric(cells[mapping.qty]), price: numeric(cells[mapping.price]),
      unit: '', brand: '三角', source: cells };
    row.validationErrors = [...(!model ? ['产品编号为空'] : []), ...validateInboundRow(row)];
    return row;
  });
}

const sameProduct = (a: Product, b: Product) => ['code', 'name', 'spec', 'brand', 'unit'].every(
  key => a[key as keyof Product] === b[key as keyof Product]);
const completeProduct = (product: Product) => [product.code, product.name, product.spec, product.unit].every(v => v.trim());

export function matchTriangle(row: TriangleRow, catalog: Catalog): TriangleResult {
  const base = { row };
  const errors = [...(!normalizeCode(row.model) ? ['产品编号为空'] : []), ...validateInboundRow(row)];
  if (errors.length) return { ...base, status: 'blocked', reason: errors.join('；') };
  const exact = catalog.products.filter(p => normalizeCode(p.code) === normalizeCode(row.model));
  if (exact.length > 1) return { ...base, status: 'blocked', reason: '目录中该编号重复，请先维护商品目录，不能默认选择其中一条。' };
  if (exact.length && !isTriangle(exact[0])) return { ...base, status: 'blocked', reason: '该编号属于其他品牌，请核对供应商和商品目录。' };
  const target = exact[0];
  if (target && !completeProduct(target)) return { ...base, status: 'blocked', reason: '商品资料缺少名称、规格或单位，请更新目录。' };
  if (!target) return { ...base, status: 'new', reason: 'SKU 未找到，已自动列为待新建商品；建档并更新目录后重新匹配。' };
  return { ...base, status: 'matched', product: target, reason: 'SKU 唯一命中，描述不参与匹配' };
}

export function buildTriangleImport(results: TriangleResult[], decisions: Record<number, TriangleDecision>, catalog: Catalog): ExportRow[] {
  const rows: TriangleRow[] = [], products = new Map<number, Product>();
  for (const result of results) {
    const decision = decisions[result.row.rowNumber];
    if (decision?.kind === 'skip') continue;
    const current = matchTriangle(result.row, catalog);
    if (current.status !== result.status) throw new Error('商品目录发生变化，请重新匹配');
    if (result.status === 'new') continue;
    if (result.status !== 'matched' || !result.product) throw new Error(`第 ${result.row.rowNumber} 行存在异常，请修正或跳过`);
    if (!current.product || !sameProduct(result.product, current.product)) throw new Error('商品目录发生变化，请重新匹配');
    rows.push(result.row); products.set(result.row.rowNumber, current.product);
  }
  return buildImportRows(rows, products, TRIANGLE_SUPPLIER);
}

export function triangleTable(headers: string[], rows: unknown[][], sheetName: string): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map(header => ({ wch: /描述|规格|说明/.test(header) ? 55 : 22 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return book;
}
