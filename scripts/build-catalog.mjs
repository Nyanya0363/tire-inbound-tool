import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';

const sourceFile = process.argv[2] || '商品资料.xlsx';
const outputFile = process.argv[3] || 'public/catalog.json';

if (!fs.existsSync(sourceFile)) {
  console.error(`找不到商品资料文件：${sourceFile}`);
  process.exit(1);
}

const COLUMN_ALIASES = {
  code: ['商品编号', '商品编码', '商品代码', '货号', '编号', 'SKU'],
  name: ['商品名称', '品名', '名称'],
  spec: ['规格/型号', '规格型号', '规格', '型号', '产品型号'],
  brand: ['品牌'],
  unit: ['单位'],
  barcode: ['条码', '条形码', '商品条码'],
};

// 表头可能不在第一行，也可能在后面的工作表。扫描每个工作表的前 100 行。
const HEADER_SCAN_LIMIT = 100;

function normalize(value) {
  // 去掉空白、全角空格、零宽字符以及所有标点符号，
  // 让“规格/型号”“规格（型号）”“规格型号”都能匹配。
  return String(value ?? '')
    .replace(/[\s​﻿]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function findColumn(headers, aliases) {
  const normalized = headers.map(normalize);
  for (const alias of aliases) {
    const target = normalize(alias);
    const index = normalized.findIndex((header) => header === target);
    if (index >= 0) return index;
  }
  for (const alias of aliases) {
    const target = normalize(alias);
    const index = normalized.findIndex((header) => header.includes(target));
    if (index >= 0) return index;
  }
  return -1;
}

function detectColumns(headers) {
  return {
    code: findColumn(headers, COLUMN_ALIASES.code),
    name: findColumn(headers, COLUMN_ALIASES.name),
    spec: findColumn(headers, COLUMN_ALIASES.spec),
    brand: findColumn(headers, COLUMN_ALIASES.brand),
    unit: findColumn(headers, COLUMN_ALIASES.unit),
    barcode: findColumn(headers, COLUMN_ALIASES.barcode),
  };
}

function countColumns(columns) {
  return Object.values(columns).filter((index) => index >= 0).length;
}

function readSheetRows(sheet) {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
}

function scanHeaderRows(workbook) {
  let best = null;
  let fallback = null;

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
      const candidate = { sheetName, headerRowIndex: rowIndex, headers, columns, score };
      if (!fallback || score > fallback.score) fallback = candidate;
      if (columns.code < 0 || columns.spec < 0) continue;
      if (!best || score > best.score) best = candidate;
    }
  }

  return { best, fallback };
}

function describeHeaders(candidate) {
  if (!candidate) return '没有找到表头行';
  const preview = candidate.headers.filter(Boolean).slice(0, 15).join('、');
  return `工作表“${candidate.sheetName}”第 ${candidate.headerRowIndex + 1} 行识别到的表头：${preview || '（空）'}`;
}

let workbook;
if (sourceFile.toLowerCase().endsWith('.csv')) {
  const buffer = fs.readFileSync(sourceFile);
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('�')) {
    try {
      const gb18030 = new TextDecoder('gb18030').decode(buffer);
      if (!gb18030.includes('�')) text = gb18030;
    } catch {
      // 环境不支持 gb18030 时保留 UTF-8 结果
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  workbook = XLSX.read(text, { type: 'string' });
} else {
  // 不用 XLSX.readFile：它对中文路径支持不好，先读成 Buffer 再解析。
  workbook = XLSX.read(fs.readFileSync(sourceFile), { type: 'buffer' });
}

if (!workbook.SheetNames.length) {
  console.error('商品资料里没有工作表');
  process.exit(1);
}

const { best, fallback } = scanHeaderRows(workbook);
if (!best) {
  console.error(
    `商品资料缺少“商品编号”或“规格/型号”列。${describeHeaders(fallback)}。` +
      `已读取工作表：${workbook.SheetNames.join('、')}`,
  );
  process.exit(1);
}

const aoa = readSheetRows(workbook.Sheets[best.sheetName]);
const columns = best.columns;
const rows = aoa.slice(best.headerRowIndex + 1);

function cell(row, index) {
  if (index < 0) return '';
  return String(row[index] ?? '').replace(/\s+/g, ' ').trim();
}

const HEADER_CODE_VALUES = new Set(COLUMN_ALIASES.code.map(normalize));
const HEADER_SPEC_VALUES = new Set(COLUMN_ALIASES.spec.map(normalize));

function isRepeatedHeader(product) {
  return (
    HEADER_CODE_VALUES.has(normalize(product.code)) &&
    HEADER_SPEC_VALUES.has(normalize(product.spec))
  );
}

const products = rows
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
  console.error(`没有解析到有效商品行。${describeHeaders(best)}`);
  process.exit(1);
}

const sourceBuffer = fs.readFileSync(sourceFile);
const version = crypto.createHash('sha256').update(sourceBuffer).digest('hex').slice(0, 12);

const catalog = {
  version,
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(sourceFile),
  products,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

console.log(`已生成 ${outputFile}`);
console.log(`商品数：${products.length}`);
console.log(`目录版本：${version}`);
