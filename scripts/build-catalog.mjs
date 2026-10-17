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

// GBK 字节被当成 Latin-1/Windows-1252 解码时会出现这种乱码，
// 例如“商品编号”会变成“ÉÌÆ·±àºÅ”。
const CP1252_BYTES = {
  '€': 0x80,
  '‚': 0x82,
  'ƒ': 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  'ˆ': 0x88,
  '‰': 0x89,
  'Š': 0x8a,
  '‹': 0x8b,
  'Œ': 0x8c,
  'Ž': 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  'š': 0x9a,
  '›': 0x9b,
  'œ': 0x9c,
  'ž': 0x9e,
  'Ÿ': 0x9f,
};

function encodeCodePageBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0xff) {
      bytes[i] = code;
      continue;
    }
    const mapped = CP1252_BYTES[text[i]];
    if (mapped === undefined) return null;
    bytes[i] = mapped;
  }
  return bytes;
}

function repairMojibake(value) {
  if (!/[\u0080-\u00ff]/.test(value)) return value;
  const bytes = encodeCodePageBytes(value);
  if (!bytes) return value;
  try {
    const decoded = new TextDecoder('gb18030').decode(bytes);
    // 只有解出中文才认为修复成功，避免误伤正常的西文内容。
    return /[\u3400-\u9fff]/.test(decoded) ? decoded : value;
  } catch {
    return value;
  }
}

function repairSheetRows(rows) {
  let needsRepair = false;
  const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const headers = (rows[rowIndex] ?? []).map((value) => String(value ?? '').trim());
    if (!headers.some(Boolean)) continue;
    const current = detectColumns(headers);
    if (current.code >= 0 || current.spec >= 0) continue;
    const repairedColumns = detectColumns(headers.map(repairMojibake));
    if (repairedColumns.code >= 0 && repairedColumns.spec >= 0) {
      needsRepair = true;
      break;
    }
  }
  if (!needsRepair) return rows;
  return rows.map((row) =>
    row.map((value) => (typeof value === 'string' ? repairMojibake(value) : value)),
  );
}

function scanHeaderRows(workbook) {
  let best = null;
  let fallback = null;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = repairSheetRows(readSheetRows(sheet));
    const limit = Math.min(rows.length, HEADER_SCAN_LIMIT);
    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const headers = (rows[rowIndex] ?? []).map((value) => String(value ?? '').trim());
      if (!headers.some(Boolean)) continue;
      const columns = detectColumns(headers);
      const score = countColumns(columns);
      const candidate = { sheetName, headerRowIndex: rowIndex, headers, columns, score, rows };
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

// 不用 XLSX.readFile：它对中文路径支持不好，先读成 Buffer。
const sourceBuffer = fs.readFileSync(sourceFile);
const isZip =
  sourceBuffer.length >= 4 &&
  sourceBuffer[0] === 0x50 &&
  sourceBuffer[1] === 0x4b &&
  sourceBuffer[2] === 0x03 &&
  sourceBuffer[3] === 0x04;
const isOle =
  sourceBuffer.length >= 4 &&
  sourceBuffer[0] === 0xd0 &&
  sourceBuffer[1] === 0xcf &&
  sourceBuffer[2] === 0x11 &&
  sourceBuffer[3] === 0xe0;

let workbook;
if (isZip || isOle) {
  workbook = XLSX.read(sourceBuffer, { type: 'buffer' });
} else {
  // 有些系统把 CSV/HTML 直接导出成 .xls/.xlsx，按文本解码后再解析。
  let text = new TextDecoder('utf-8').decode(sourceBuffer);
  if (text.includes('�')) {
    try {
      const gb18030 = new TextDecoder('gb18030').decode(sourceBuffer);
      if (!gb18030.includes('�')) text = gb18030;
    } catch {
      // 环境不支持 gb18030 时保留 UTF-8 结果
    }
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  workbook = XLSX.read(text, { type: 'string' });
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

const aoa = best.rows;
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
