import * as XLSX from 'xlsx';
import type { Catalog, Product } from './types';

const COLUMN_ALIASES = {
  code: ['商品编号', '商品编码', '商品代码', '货号', '编号', 'SKU'],
  name: ['商品名称', '品名', '名称'],
  spec: ['规格/型号', '规格型号', '规格', '型号', '产品型号'],
  brand: ['品牌'],
  unit: ['单位'],
  barcode: ['条码', '条形码', '商品条码'],
} as const;

type ColumnKey = keyof typeof COLUMN_ALIASES;
type ColumnMap = Record<ColumnKey, number>;

// 表头可能不在第一行（上面有标题、说明、空行），也可能在后面的工作表。
// 扫描每个工作表的前 100 行，取列名命中最多的一行作为表头。
const HEADER_SCAN_LIMIT = 100;

function normalizeHeader(value: unknown): string {
  // 去掉空白、全角空格、零宽字符以及所有标点符号，
  // 让“规格/型号”“规格（型号）”“规格型号”都能匹配。
  return String(value ?? '')
    .replace(/[\s​﻿]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function findColumn(headers: string[], aliases: readonly string[]): number {
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

function detectColumns(headers: string[]): ColumnMap {
  return {
    code: findColumn(headers, COLUMN_ALIASES.code),
    name: findColumn(headers, COLUMN_ALIASES.name),
    spec: findColumn(headers, COLUMN_ALIASES.spec),
    brand: findColumn(headers, COLUMN_ALIASES.brand),
    unit: findColumn(headers, COLUMN_ALIASES.unit),
    barcode: findColumn(headers, COLUMN_ALIASES.barcode),
  };
}

function countColumns(columns: ColumnMap): number {
  return Object.values(columns).filter((index) => index >= 0).length;
}

interface HeaderCandidate {
  sheetName: string;
  headerRowIndex: number;
  headers: string[];
  columns: ColumnMap;
  score: number;
}

function readSheetRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  });
}

function scanHeaderRows(workbook: XLSX.WorkBook): {
  best: HeaderCandidate | null;
  fallback: HeaderCandidate | null;
} {
  let best: HeaderCandidate | null = null;
  let fallback: HeaderCandidate | null = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = readSheetRows(sheet);
    const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const headers = (rows[rowIndex] ?? []).map((value) => String(value ?? '').trim());
      if (!headers.some(Boolean)) continue;
      const columns = detectColumns(headers);
      const score = countColumns(columns);
      const candidate: HeaderCandidate = {
        sheetName,
        headerRowIndex: rowIndex,
        headers,
        columns,
        score,
      };
      if (!fallback || score > fallback.score) fallback = candidate;
      if (columns.code < 0 || columns.spec < 0) continue;
      if (!best || score > best.score) best = candidate;
    }
  }

  return { best, fallback };
}

function describeHeaders(candidate: HeaderCandidate | null): string {
  if (!candidate) return '没有找到表头行';
  const preview = candidate.headers.filter(Boolean).slice(0, 15).join('、');
  return `工作表“${candidate.sheetName}”第 ${candidate.headerRowIndex + 1} 行识别到的表头：${preview || '（空）'}`;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// 国内系统导出的 CSV 常见 GBK/GB18030 编码，按 UTF-8 读会变乱码。
function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) {
    try {
      const gb18030 = new TextDecoder('gb18030').decode(bytes);
      if (!gb18030.includes('�')) text = gb18030;
    } catch {
      // 环境不支持 gb18030 时保留 UTF-8 结果
    }
  }
  return stripBom(text);
}

async function readWorkbook(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  if (file.name.toLowerCase().endsWith('.csv')) {
    return XLSX.read(decodeCsv(buffer), { type: 'string' });
  }
  return XLSX.read(buffer, { type: 'array' });
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

const HEADER_CODE_VALUES = new Set(COLUMN_ALIASES.code.map(normalizeHeader));
const HEADER_SPEC_VALUES = new Set(COLUMN_ALIASES.spec.map(normalizeHeader));

function isRepeatedHeader(product: Product): boolean {
  return (
    HEADER_CODE_VALUES.has(normalizeHeader(product.code)) &&
    HEADER_SPEC_VALUES.has(normalizeHeader(product.spec))
  );
}

export async function buildCatalogFromFile(file: File): Promise<CatalogBuildResult> {
  const workbook = await readWorkbook(file);
  if (!workbook.SheetNames.length) throw new Error('商品资料里没有工作表');

  const { best, fallback } = scanHeaderRows(workbook);
  if (!best) {
    throw new Error(
      `商品资料缺少“商品编号”或“规格/型号”列。${describeHeaders(fallback)}。` +
        `已读取工作表：${workbook.SheetNames.join('、')}`,
    );
  }

  const aoa = readSheetRows(workbook.Sheets[best.sheetName]);
  const columns = best.columns;
  const products: Product[] = aoa
    .slice(best.headerRowIndex + 1)
    .map((row) => ({
      code: cell(row, columns.code),
      name: cell(row, columns.name),
      spec: cell(row, columns.spec),
      brand: cell(row, columns.brand),
      unit: cell(row, columns.unit),
      barcode: cell(row, columns.barcode),
    }))
    .filter((product) => product.code && product.spec && !isRepeatedHeader(product));

  if (!products.length) {
    throw new Error(`没有解析到有效商品行。${describeHeaders(best)}`);
  }

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
