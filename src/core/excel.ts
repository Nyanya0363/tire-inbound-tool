import * as XLSX from 'xlsx';
import type { BrandAdapter } from '../brands/types';
import type {
  ExportRow,
  InputMapping,
  MatchTrace,
  ParsedWorkbook,
  RawInboundRow,
} from './types';

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s　]+/g, '')
    .replace(/[：:（）()]/g, '')
    .trim();
}

const HEADER_TOKENS = new Set([
  '序号',
  '品牌',
  '规格',
  '型号',
  '规格/型号',
  '产品型号',
  '单位',
  '价格',
  '单价',
  '数量',
  '金额',
  '当期',
  '规模',
  '促销',
  '现金',
  '底价',
  '付款',
]);

function isHeaderLikeRow(row: Record<string, unknown>, mapping: InputMapping): boolean {
  const model = normalizeHeader(row[mapping.model]);
  const qty = mapping.qty ? normalizeHeader(row[mapping.qty]) : '';
  const price = mapping.price ? normalizeHeader(row[mapping.price]) : '';
  return HEADER_TOKENS.has(model) || HEADER_TOKENS.has(qty) || HEADER_TOKENS.has(price);
}

function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const cells = rows[i].map(normalizeHeader);
    const hasModel = cells.some(
      (cell) => cell.includes('规格') || cell.includes('型号') || cell.includes('产品型号'),
    );
    const hasQty = cells.some((cell) => cell.includes('数量'));
    if (hasModel && hasQty) return i;
  }
  return 0;
}

function pickHeader(headers: string[], aliases: string[]): string {
  const normalized = headers.map(normalizeHeader);
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const exact = headers.find((_, index) => normalized[index] === target);
    if (exact) return exact;
  }
  for (const alias of aliases) {
    const target = normalizeHeader(alias);
    const partial = headers.find((_, index) => normalized[index].includes(target));
    if (partial) return partial;
  }
  return '';
}

export function detectMapping(headers: string[], adapter: BrandAdapter): InputMapping {
  return {
    model: pickHeader(headers, adapter.inputAliases.model),
    qty: pickHeader(headers, adapter.inputAliases.qty),
    // Prefer 底价 if it exists because the template uses the net purchase price.
    price:
      pickHeader(headers, ['底价']) ||
      pickHeader(headers, adapter.inputAliases.price),
    unit: pickHeader(headers, adapter.inputAliases.unit),
    brand: pickHeader(headers, adapter.inputAliases.brand),
  };
}

export async function readInboundWorkbook(
  file: File,
  adapter: BrandAdapter,
): Promise<ParsedWorkbook> {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  const workbook = isCsv
    ? XLSX.read(await file.text(), { type: 'string' })
    : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 里没有工作表');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  const headerRowIndex = findHeaderRow(rows);
  const rawHeaders = (rows[headerRowIndex] ?? []).map((cell) => String(cell ?? '').trim());
  const headers = rawHeaders.filter(Boolean);
  if (!headers.length) throw new Error('没有识别到表头');

  const sectionTitles = rows
    .map((row, index) => ({
      rowNumber: index + 1,
      text: row
        .map((cell) => String(cell ?? '').trim())
        .filter(Boolean)
        .join(' '),
    }))
    .filter(
      (item) =>
        /出库/.test(item.text) &&
        /\d{1,2}\s*[.\-/月]\s*\d{1,2}/.test(item.text),
    );

  const objectRows: Array<Record<string, unknown>> = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const objectRow: Record<string, unknown> = { __rowNumber: rowIndex + 1 };
    let hasValue = false;
    rawHeaders.forEach((header, columnIndex) => {
      if (!header) return;
      const value = row[columnIndex] ?? '';
      objectRow[header] = value;
      if (String(value ?? '').trim() !== '') hasValue = true;
    });
    if (hasValue) objectRows.push(objectRow);
  }

  return {
    fileName: file.name,
    sheetName,
    sheetNames: workbook.SheetNames,
    headers,
    headerRowIndex,
    sectionTitles,
    rows: objectRows,
    mapping: detectMapping(headers, adapter),
  };
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  const text = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^[￥¥]\s*/, '')
    .replace(/\s*元$/, '')
    .trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+|\d{1,3}(?:,\d{3})+(?:\.\d*)?)$/.test(text)) return NaN;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : NaN;
}

export function validateInboundRow(row: Pick<RawInboundRow, 'qty' | 'price' | 'validationErrors'>): string[] {
  const errors = [...(row.validationErrors ?? [])];
  if (!Number.isFinite(row.qty)) {
    if (!errors.some(error => error.startsWith('数量'))) errors.push('数量为空或不是有效数字');
  }
  else if (!Number.isSafeInteger(row.qty) || row.qty <= 0) errors.push('数量必须为正整数');
  if (!Number.isFinite(row.price)) {
    if (!errors.some(error => error.startsWith('单价'))) errors.push('单价为空或不是有效数字');
  }
  else if (row.price <= 0) errors.push('单价必须大于 0，请核实原表或单价列');
  else if (Number.isFinite(row.qty) && !Number.isFinite(row.qty * row.price)) errors.push('数量与单价乘积超出有效范围');
  return [...new Set(errors)];
}

export interface InboundAnalysis {
  rows: RawInboundRow[];
  ignoredHeaderRows: number;
  ignoredEmptyModelRows: number;
}

export function analyzeInboundRows(
  workbook: ParsedWorkbook,
  mapping: InputMapping,
  defaultBrand: string,
): InboundAnalysis {
  if (!mapping.model) {
    throw new Error('请先选择“型号/规格”列');
  }

  const rows: RawInboundRow[] = [];
  let ignoredHeaderRows = 0;
  let ignoredEmptyModelRows = 0;

  for (const row of workbook.rows) {
    const rawModel = String(row[mapping.model] ?? '').trim();
    if (!rawModel) {
      ignoredEmptyModelRows += 1;
      continue;
    }
    // The original manufacturer sheet can contain several tables. Repeated
    // header rows inside the sheet must not become product rows.
    if (isHeaderLikeRow(row, mapping)) {
      ignoredHeaderRows += 1;
      continue;
    }
    const qty = parseNumber(row[mapping.qty]);
    const price = parseNumber(row[mapping.price]);
    const numericError = (field: string, value: unknown, number: number) => Number.isFinite(number) ? []
      : [`${field}${String(value ?? '').trim() ? `不是有效数字（原值：${String(value)}）` : '为空'}`];
    const validationErrors = validateInboundRow({ qty, price, validationErrors: [
      ...numericError('数量', row[mapping.qty], qty),
      ...numericError('单价', row[mapping.price], price),
    ] });
    const unit = mapping.unit ? String(row[mapping.unit] ?? '').trim() : '';
    const brand = mapping.brand
      ? String(row[mapping.brand] ?? '').trim() || defaultBrand
      : defaultBrand;
    rows.push({
      rowNumber: Number(row.__rowNumber ?? 0),
      model: rawModel,
      qty,
      price,
      unit,
      brand,
      source: row,
      ...(validationErrors.length ? { validationErrors } : {}),
    });
  }

  return { rows, ignoredHeaderRows, ignoredEmptyModelRows };
}

export function buildInboundRows(
  workbook: ParsedWorkbook,
  mapping: InputMapping,
  defaultBrand: string,
): RawInboundRow[] {
  return analyzeInboundRows(workbook, mapping, defaultBrand).rows;
}

export function buildImportRows(
  rows: RawInboundRow[],
  resolved: Map<number, { code: string; name: string; spec: string; unit: string }>,
  supplierName: string,
  excludedRows: ReadonlySet<number> = new Set(),
): ExportRow[] {
  return rows
    .map((row) => {
      const product = resolved.get(row.rowNumber);
      if (!product || excludedRows.has(row.rowNumber)) return null;
      const errors = validateInboundRow(row);
      if (errors.length) throw new Error(`第 ${row.rowNumber} 行不能导出：${errors.join('；')}`);
      if (![product.code, product.name, product.spec, product.unit, supplierName].every(value => value.trim())) {
        throw new Error(`第 ${row.rowNumber} 行商品资料或供应商不完整，不能导出`);
      }
      return {
        supplier: supplierName,
        code: product.code,
        name: product.name,
        spec: product.spec,
        unit: product.unit,
        qty: row.qty,
        price: row.price,
      } satisfies ExportRow;
    })
    .filter((row): row is ExportRow => row !== null);
}

const INBOUND_HEADERS = [
  '序号',
  '品牌',
  '规格',
  '单位',
  '价格',
  '数量',
  '金额',
  '当期',
  '规模',
  '促销',
  '现金',
  '底价',
  '付款',
];

function createInboundTemplate(data: unknown[][]): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet([INBOUND_HEADERS, ...data]);
  sheet['!cols'] = [
    { wch: 6 },
    { wch: 8 },
    { wch: 42 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 10 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 8 },
    { wch: 12 },
    { wch: 8 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return workbook;
}

export function createBlankInboundWorkbook(): XLSX.WorkBook {
  return createInboundTemplate([]);
}

export function createSampleInboundWorkbook(adapter: BrandAdapter): XLSX.WorkBook {
  return createInboundTemplate([
    [1, adapter.label, 'HAIDA 165R14LT 8PR 96/95Q  HD517', '条', 161, 63, 10143, 0.005, 0.02, 0.11, 0.01, 137.87235, ''],
    [2, adapter.label, 'HAIDA 175R14LT 8PR 99/97R  HD517', '条', 179, 189, 33831, 0.005, 0.02, 0.11, 0.01, 153.28665, ''],
    [3, '天府', 'TIANFU 145R12LT 8PR 86/84Q RD-224', '条', 100, 10, 1000, 0, 0, 0, 0, 100, ''],
  ]);
}

export function createImportWorkbook(rows: ExportRow[]): XLSX.WorkBook {
  const headers = ['供应商', '商品编号', '商品名称', '规格', '单位', '数量', '单价'];
  const data = [
    headers,
    ...rows.map((row) => [
      row.supplier,
      row.code,
      row.name,
      row.spec,
      row.unit,
      row.qty,
      row.price,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [
    { wch: 36 },
    { wch: 26 },
    { wch: 16 },
    { wch: 42 },
    { wch: 8 },
    { wch: 10 },
    { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  return workbook;
}

export function createNewProductWorkbook(rows: RawInboundRow[], supplierName: string, priceField: string): XLSX.WorkBook {
  const data = [
    ['源文件行号', '供应商', '品牌', '厂家型号', '单位', '数量', '单价', '单价口径', '状态', '处理说明'],
    ...rows.map(row => [row.rowNumber, supplierName, row.brand, row.model, row.unit, row.qty, row.price,
      priceField, '待新建商品', '人工核对后回业务系统新建商品，更新商品目录后重新匹配；本行未写入入库导入模板。']),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [10, 38, 10, 52, 8, 10, 14, 12, 16, 80].map(wch => ({ wch }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '待新建商品清单');
  return workbook;
}

const STATUS_LABEL: Record<string, string> = {
  matched: '已匹配',
  review: '待确认',
  unmatched: '未找到',
};

const METHOD_LABEL: Record<string, string> = {
  alias: '人工映射',
  exact: '完全匹配',
  core: '核心字段匹配',
  candidate: '候选',
  manual: '手动选择',
  none: '无',
};

export function createReportWorkbook(traces: MatchTrace[], catalogVersion: string): XLSX.WorkBook {
  const headers = [
    'Excel行号',
    '厂家型号',
    '品牌',
    '花纹',
    '规格',
    '层级',
    '载重速度',
    '状态',
    '匹配商品编号',
    '匹配方式',
    '说明',
    '候选商品',
    '商品目录版本',
  ];
  const data = [
    headers,
    ...traces.map((trace) => [
      trace.rowNumber,
      trace.rawModel,
      trace.parsed?.brand ?? '',
      trace.parsed?.pattern ?? '',
      trace.parsed?.size ?? '',
      trace.parsed?.ply ?? '',
      trace.parsed?.loadSpeed ?? '',
      STATUS_LABEL[trace.result] ?? trace.result,
      trace.matchedCode ?? '',
      METHOD_LABEL[trace.method] ?? trace.method,
      trace.reason ?? trace.warning ?? '',
      trace.candidates
        .map((candidate) => `${candidate.code}(${candidate.score}) ${candidate.reason}`)
        .join(' | '),
      catalogVersion,
    ]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet['!cols'] = [
    { wch: 10 },
    { wch: 42 },
    { wch: 8 },
    { wch: 12 },
    { wch: 18 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 26 },
    { wch: 14 },
    { wch: 52 },
    { wch: 60 },
    { wch: 16 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '匹配报告');
  return workbook;
}

export function downloadWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
  format: 'xlsx' | 'xls' = 'xlsx',
): void {
  XLSX.writeFile(workbook, fileName, { bookType: format });
}
