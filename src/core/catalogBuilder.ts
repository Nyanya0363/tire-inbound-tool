import * as XLSX from 'xlsx';
import type { Catalog, Product } from './types';

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[：:（）()]/g, '')
    .trim();
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const cells = (rows[i] ?? []).map(normalizeHeader);
    if (cells.some((cell) => cell.includes('商品编号')) && cells.some((cell) => cell.includes('规格'))) {
      return i;
    }
  }
  return 0;
}

function findColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const index = normalized.findIndex((header) => header === target);
    if (index >= 0) return index;
  }
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const index = normalized.findIndex((header) => header.includes(target));
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row: unknown[], index: number): string {
  if (index < 0) return '';
  return String(row[index] ?? '').replace(/\s+/g, ' ').trim();
}

async function hashFile(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 12);
  } catch {
    return `${Date.now()}`.slice(-12);
  }
}

export interface CatalogBuildResult {
  catalog: Catalog;
  duplicateCodes: string[];
}

export interface CatalogDiff {
  added: Product[];
  removed: Product[];
  changed: Array<{ before: Product; after: Product }>;
  brandCounts: Array<{ brand: string; count: number }>;
}

function sameProduct(a: Product, b: Product): boolean {
  return (
    a.name === b.name &&
    a.spec === b.spec &&
    a.brand === b.brand &&
    a.unit === b.unit &&
    (a.barcode ?? '') === (b.barcode ?? '')
  );
}

export function diffCatalogs(current: Catalog | undefined, next: Catalog): CatalogDiff {
  const beforeMap = new Map((current?.products ?? []).map((product) => [product.code, product]));
  const afterMap = new Map(next.products.map((product) => [product.code, product]));

  const added = next.products.filter((product) => !beforeMap.has(product.code));
  const removed = (current?.products ?? []).filter((product) => !afterMap.has(product.code));
  const changed: Array<{ before: Product; after: Product }> = [];

  next.products.forEach((after) => {
    const before = beforeMap.get(after.code);
    if (before && !sameProduct(before, after)) {
      changed.push({ before, after });
    }
  });

  const brandCounter = new Map<string, number>();
  next.products.forEach((product) => {
    const brand = product.brand || '未标注品牌';
    brandCounter.set(brand, (brandCounter.get(brand) ?? 0) + 1);
  });

  return {
    added,
    removed,
    changed,
    brandCounts: [...brandCounter.entries()]
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export async function buildCatalogFromFile(file: File): Promise<CatalogBuildResult> {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('商品资料里没有工作表');
  const sheet = workbook.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  const headerRow = findHeaderRow(aoa);
  const headers = (aoa[headerRow] ?? []).map((value) => String(value ?? '').trim());
  const columns = {
    code: findColumn(headers, ['商品编号', '商品编码', 'SKU', '编号']),
    name: findColumn(headers, ['商品名称', '品名']),
    spec: findColumn(headers, ['规格/型号', '规格型号', '规格', '型号']),
    brand: findColumn(headers, ['品牌']),
    unit: findColumn(headers, ['单位']),
    barcode: findColumn(headers, ['条码', '条形码']),
  };
  if (columns.code < 0 || columns.spec < 0) {
    throw new Error('商品资料缺少“商品编号”或“规格/型号”列');
  }

  const products: Product[] = aoa
    .slice(headerRow + 1)
    .map((row) => ({
      code: cell(row, columns.code),
      name: cell(row, columns.name),
      spec: cell(row, columns.spec),
      brand: cell(row, columns.brand),
      unit: cell(row, columns.unit),
      barcode: cell(row, columns.barcode),
    }))
    .filter((product) => product.code && product.spec);

  if (!products.length) throw new Error('没有解析到有效商品行');

  const counts = new Map<string, number>();
  products.forEach((product) => {
    counts.set(product.code, (counts.get(product.code) ?? 0) + 1);
  });
  const duplicateCodes = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([code]) => code);

  return {
    catalog: {
      version: await hashFile(file),
      generatedAt: new Date().toISOString(),
      sourceFile: file.name,
      products,
    },
    duplicateCodes,
  };
}
