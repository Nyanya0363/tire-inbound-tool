import * as XLSX from 'xlsx';
import type { Catalog, ExportRow, Product, RawInboundRow } from '../../core/types';
import { buildImportRows, validateInboundRow } from '../../core/excel';
import { extractLoadSpeed, extractPly, extractSize, normalizeText } from '../../core/text';

export const TRIANGLE_SUPPLIER = '三角轮胎股份有限公司';
export const TRIANGLE_MEMORY_KEY = 'tire-inbound:triangle-code-mappings:v1';
export const TRIANGLE_HEADERS = ['产品', '产品描述', '数量', '价格', '发货日期', '车牌号', '销售订单号'];
export interface TriangleMapping { code: string; description: string; qty: string; price: string; date: string }
export interface TriangleWorkbook {
  fileName: string; sheetName: string; sheetCount: number; headers: string[];
  rows: Array<{ rowNumber: number; cells: Record<string, unknown> }>; mapping: TriangleMapping;
}
export interface TriangleRow extends RawInboundRow { description: string; date: string }
export interface TriangleMemory { product: Product; sourceCode: string; description: string }
export type TriangleMemories = Record<string, TriangleMemory>;
export type TriangleDecision = { kind: 'skip' | 'new' } | { kind: 'product'; product: Product };
export interface TriangleResult {
  row: TriangleRow; status: 'matched' | 'review' | 'blocked'; reason: string;
  product?: Product; candidate?: Product; canChoose: boolean;
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
  if (headerIndex < 0) throw new Error('未找到三角表头，请保留“产品、数量、价格”列，产品描述可用于辅助核对。');
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

export function triangleDescriptionDifferences(source: string, target: string): string[] {
  if (!source.trim()) return []; // The supplier product code is the primary identity.
  const left = normalizeText(source), right = normalizeText(target);
  const pattern = (s: string) => s.match(/\bT[A-Z]*\d+[A-Z]*/)?.[0];
  const fields = [
    ['规格', extractSize(left), extractSize(right)], ['花纹', pattern(left), pattern(right)],
    ['层级', extractPly(left), extractPly(right)], ['载重速度', extractLoadSpeed(left), extractLoadSpeed(right)],
  ];
  const differences: string[] = [];
  for (const [label, a, b] of fields) {
    if (a && b && a !== b) differences.push(`${label}不同：厂家 ${a}，目录 ${b}`);
    else if ((!a || !b) && (label === '规格' || label === '花纹')) differences.push(`${label}未完整识别，请核对双方原文`);
  }
  for (const flag of ['PRO', 'PLUS', 'EVT', 'EV', 'XL']) {
    const token = new RegExp(`\\b${flag}\\b`);
    if (token.test(left) !== token.test(right)) differences.push(`${flag} 标识不同：厂家${token.test(left) ? '有' : '未标注'}，目录${token.test(right) ? '有' : '未标注'}`);
  }
  for (const flag of ['白字', '黑字', '自修复', '自补', '静音棉', '缺气保用']) {
    if (left.includes(flag) !== right.includes(flag)) differences.push(`${flag} 标识不同，请逐条核对`);
  }
  return differences;
}

export function triangleMemoryKey(row: TriangleRow): string {
  return JSON.stringify([normalizeCode(row.model), normalizeText(row.description)]);
}
const sameProduct = (a: Product, b: Product) => ['code', 'name', 'spec', 'brand', 'unit'].every(
  key => a[key as keyof Product] === b[key as keyof Product]);
const completeProduct = (product: Product) => [product.code, product.name, product.spec, product.unit].every(v => v.trim());

export function matchTriangle(row: TriangleRow, catalog: Catalog, memories: TriangleMemories = {}): TriangleResult {
  const base = { row, canChoose: true };
  const errors = [...(!normalizeCode(row.model) ? ['产品编号为空'] : []), ...validateInboundRow(row)];
  if (errors.length) return { ...base, status: 'blocked', canChoose: false, reason: errors.join('；') };
  const exact = catalog.products.filter(p => normalizeCode(p.code) === normalizeCode(row.model));
  if (exact.length > 1) return { ...base, status: 'blocked', canChoose: false, reason: '目录中该编号重复，请先维护商品目录，不能默认选择其中一条。' };
  if (exact.length && !isTriangle(exact[0])) return { ...base, status: 'blocked', canChoose: false, reason: '该编号属于其他品牌，请核对供应商和商品目录。' };
  const target = exact[0];
  if (target && !completeProduct(target)) return { ...base, status: 'blocked', canChoose: false, reason: '商品资料缺少名称、规格或单位，请更新目录。' };
  const differences = target ? triangleDescriptionDifferences(row.description, target.spec) : [];
  const memory = memories[triangleMemoryKey(row)];
  if (memory) {
    const products = catalog.products.filter(p => normalizeCode(p.code) === normalizeCode(memory.product.code));
    const current = products.length === 1 ? products[0] : undefined;
    if (current && isTriangle(current) && completeProduct(current) && sameProduct(memory.product, current)
      && normalizeCode(memory.sourceCode) === normalizeCode(row.model) && normalizeText(memory.description) === normalizeText(row.description)
      && (!target || target.code === current.code)) {
      return { ...base, status: 'matched', product: current, reason: '命中三角已核对记忆，厂家编号、描述和商品快照一致' };
    }
    return { ...base, status: 'review', candidate: target, reason: '已保存的三角对应关系已失效或存在冲突，请重新核对。' };
  }
  if (!target) return { ...base, status: 'review', reason: '未找到该产品编号，请选择已有商品、标记待新建或本次跳过。' };
  if (differences.length) return { ...base, status: 'review', candidate: target, reason: differences.join('；') };
  return { ...base, status: 'matched', product: target, reason: '三角产品编号唯一命中' };
}

export function triangleSelectableProducts(catalog: Catalog): Product[] {
  const counts = new Map<string, number>();
  for (const p of catalog.products) counts.set(normalizeCode(p.code), (counts.get(normalizeCode(p.code)) ?? 0) + 1);
  return catalog.products.filter(p => isTriangle(p) && completeProduct(p) && counts.get(normalizeCode(p.code)) === 1);
}

export function resolveTriangle(result: TriangleResult, decision?: TriangleDecision): TriangleResult {
  if (decision?.kind === 'product' && result.canChoose) return { ...result, status: 'matched', product: decision.product, reason: '已逐条人工核对商品' };
  return result;
}

export function buildTriangleImport(results: TriangleResult[], decisions: Record<number, TriangleDecision>, catalog: Catalog): ExportRow[] {
  const rows: TriangleRow[] = [], products = new Map<number, Product>();
  for (const result of results) {
    const decision = decisions[result.row.rowNumber];
    if (decision?.kind === 'skip' || decision?.kind === 'new') continue;
    const resolved = resolveTriangle(result, decision);
    if (resolved.status !== 'matched' || !resolved.product) throw new Error(`第 ${result.row.rowNumber} 行尚未处理`);
    const current = catalog.products.filter(p => normalizeCode(p.code) === normalizeCode(resolved.product!.code));
    if (current.length !== 1 || !isTriangle(current[0]) || !sameProduct(resolved.product, current[0])) throw new Error('商品目录发生变化或编号重复，请重新匹配');
    rows.push(result.row); products.set(result.row.rowNumber, current[0]);
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

export function readTriangleMemories(value: unknown): TriangleMemories {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, memory]) => {
    if (!memory || typeof memory !== 'object') return false;
    const m = memory as TriangleMemory;
    return typeof m.sourceCode === 'string' && typeof m.description === 'string' && m.product
      && ['code', 'name', 'spec', 'brand', 'unit'].every(key => typeof m.product[key as keyof Product] === 'string') && isTriangle(m.product);
  }));
}
