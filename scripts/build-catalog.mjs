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

const workbook = XLSX.readFile(sourceFile);
const sheetName = workbook.SheetNames[0];
if (!sheetName) {
  console.error('商品资料里没有工作表');
  process.exit(1);
}
const sheet = workbook.Sheets[sheetName];
const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

function normalize(value) {
  return String(value ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[：:（）()]/g, '')
    .trim();
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const cells = (rows[i] ?? []).map(normalize);
    if (cells.some((cell) => cell.includes('商品编号')) && cells.some((cell) => cell.includes('规格'))) {
      return i;
    }
  }
  return 0;
}

const headerIndex = findHeaderRow(aoa);
const headers = (aoa[headerIndex] ?? []).map((cell) => String(cell ?? '').trim());
const rows = aoa.slice(headerIndex + 1);

function findColumn(aliases) {
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

const columns = {
  code: findColumn(['商品编号', '商品编码', 'SKU', '编号']),
  name: findColumn(['商品名称', '品名']),
  spec: findColumn(['规格/型号', '规格型号', '规格', '型号']),
  brand: findColumn(['品牌']),
  unit: findColumn(['单位']),
  barcode: findColumn(['条码', '条形码']),
};

if (columns.code < 0 || columns.spec < 0) {
  console.error('商品资料缺少“商品编号”或“规格/型号”列');
  process.exit(1);
}

function cell(row, index) {
  if (index < 0) return '';
  return String(row[index] ?? '').replace(/\s+/g, ' ').trim();
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
  .filter((product) => product.code && product.spec);

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
