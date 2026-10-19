import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { CatalogAdmin } from './components/CatalogAdmin';
import { DiffDialog } from './components/DiffDialog';
import { ExportConfirmDialog } from './components/ExportConfirmDialog';
import { HelpDialog } from './components/HelpDialog';
import { MappingManager } from './components/MappingManager';
import { ProductPicker } from './components/ProductPicker';
import { RecentHistory } from './components/RecentHistory';
import { TutorialAdmin } from './components/TutorialAdmin';
import { brandAdapters, getBrandAdapter } from './brands';
import type { BrandAdapter } from './brands/types';
import { loadCatalog } from './core/catalog';
import { diffTire } from './core/diff';
import type { TireDiff } from './core/diff';
import { addHistory, loadHistory } from './core/history';
import type { HistoryEntry } from './core/history';
import { loadTutorials } from './core/tutorials';
import type { Tutorial } from './core/tutorials';
import {
  analyzeInboundRows,
  buildImportRows,
  buildInboundRows,
  createBlankInboundWorkbook,
  createImportWorkbook,
  createNewProductWorkbook,
  createReportWorkbook,
  createSampleInboundWorkbook,
  downloadWorkbook,
  readInboundWorkbook,
  validateInboundRow,
} from './core/excel';
import {
  buildBrandIndex,
  makeAliasKey,
  matchRow,
  unsupportedBrandResult,
} from './core/matcher';
import { normalizeBrand, samePatternFamily } from './core/text';
import { forgetAlias, readAliases, rememberAlias } from './core/aliases';
import { pendingRows, resolveResult } from './core/workflow';
import type { AliasMap } from './core/aliases';
import { downloadDiagnostics, logger } from './core/logger';
import type {
  Catalog,
  InputMapping,
  MatchResult,
  ParsedWorkbook,
  Product,
  RawInboundRow,
} from './core/types';

const EMPTY_MAPPING: InputMapping = {
  model: '',
  qty: '',
  price: '',
  unit: '',
  brand: '',
};

function todayText(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function formatAmount(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function aliasStorageKey(adapter: BrandAdapter): string {
  return `tire-inbound:aliases:${adapter.id}`;
}

function loadAliases(adapter: BrandAdapter): AliasMap {
  try {
    const raw = localStorage.getItem(aliasStorageKey(adapter));
    return raw ? readAliases(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function saveAliases(adapter: BrandAdapter, aliases: AliasMap): void {
  localStorage.setItem(aliasStorageKey(adapter), JSON.stringify(aliases));
}

function statusInfo(result: MatchResult, pendingNew = false): {
  label: '可导入' | '需确认' | '不可导入' | '待新建';
  className: string;
  detail: string;
} {
  if (pendingNew) return { label: '待新建', className: 'badge review', detail: '本次入库模板已排除，可导出新建清单' };
  if (result.status === 'matched') {
    const detail =
      result.method === 'manual'
        ? '手动选择'
        : result.method === 'alias'
          ? '映射记忆'
          : result.method === 'core'
            ? '核心字段已确认'
            : '完全匹配';
    return { label: '可导入', className: 'badge matched', detail };
  }
  if (result.status === 'review') {
    return {
      label: '需确认',
      className: 'badge review',
      detail: result.reason?.startsWith('数据异常') ? '数据异常，需修正原表'
        : result.method === 'core' ? '核心字段待核对' : '有候选，需人工选择',
    };
  }
  const detail = result.reason?.includes('尚未配置匹配规则')
    ? '品牌未配置'
    : result.reason?.startsWith('无法解析型号')
      ? '型号无法解析'
      : '商品资料无对应商品';
  return { label: '不可导入', className: 'badge unmatched', detail };
}

function methodLabel(result: MatchResult): string {
  switch (result.method) {
    case 'exact':
      return '完全匹配';
    case 'core':
      return '核心字段匹配';
    case 'alias':
      return '人工映射记忆';
    case 'manual':
      return '手动选择';
    case 'candidate':
      return '候选';
    default:
      return '无';
  }
}

export default function App() {
  const [brandId, setBrandId] = useState(brandAdapters[0]?.id ?? '');
  const adapter = useMemo(
    () => getBrandAdapter(brandId) ?? brandAdapters[0],
    [brandId],
  );
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState('');
  const [workbook, setWorkbook] = useState<ParsedWorkbook | null>(null);
  const [mapping, setMapping] = useState<InputMapping>(EMPTY_MAPPING);
  const [supplierName, setSupplierName] = useState(adapter?.supplierName ?? '');
  const [rows, setRows] = useState<RawInboundRow[]>([]);
  const [results, setResults] = useState<MatchResult[]>([]);
  const [manual, setManual] = useState<Record<number, string>>({});
  const [confirmed, setConfirmed] = useState<Record<number, boolean>>({});
  const [newProducts, setNewProducts] = useState<Record<number, boolean>>({});
  const [skipped, setSkipped] = useState<Record<number, boolean>>({});
  const [filter, setFilter] = useState<'all' | 'review' | 'importable' | 'blocked'>('all');
  const [reviewGroup, setReviewGroup] = useState<string>('all');
  const [showMapping, setShowMapping] = useState(false);
  const [diffRow, setDiffRow] = useState<number | null>(null);
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'xls' | null>(null);
  const [lastExport, setLastExport] = useState<{ fileName: string; rows: number } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aliases, setAliases] = useState<AliasMap>({});
  const [backupRevision, setBackupRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerRow, setPickerRow] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newProductRows = useMemo(() => rows.filter(row => newProducts[row.rowNumber]), [rows, newProducts]);

  useEffect(() => {
    loadCatalog()
      .then((data) => setCatalog(data))
      .catch((err: unknown) => {
        setCatalogError(err instanceof Error ? err.message : String(err));
      });
    loadTutorials()
      .then((data) => setTutorials(data.tutorials))
      .catch(() => setTutorials([]));
  }, []);

  useEffect(() => {
    setResults([]);
    setManual({});
    setConfirmed({});
    setNewProducts({});
    setSkipped({});
    setFilter('all');
    setReviewGroup('all');
    setShowMapping(false);
    setDiffRow(null);
    setExportFormat(null);
    setLastExport(null);
  }, [catalog]);

  useEffect(() => {
    if (!adapter) return;
    setAliases(loadAliases(adapter));
    setSupplierName(adapter.supplierName);
    setWorkbook(null);
    setMapping(EMPTY_MAPPING);
    setRows([]);
    setResults([]);
    setManual({});
    setConfirmed({});
    setNewProducts({});
    setSkipped({});
    setFilter('all');
    setReviewGroup('all');
    setShowMapping(false);
    setDiffRow(null);
    setExportFormat(null);
    setLastExport(null);
    setError('');
  }, [adapter]);

  const index = useMemo(() => {
    if (!catalog || !adapter) return null;
    return buildBrandIndex(catalog, adapter);
  }, [catalog, adapter]);

  const effectiveResults = useMemo(() => {
    if (!index) return results;
    const source = new Map(rows.map(row => [row.rowNumber, row]));
    return results.map(result => {
      const n = result.trace.rowNumber;
      return resolveResult(result, source.get(n), index, manual[n], confirmed[n], newProducts[n] ? 'new' : skipped[n] ? 'skip' : undefined);
    });
  }, [results, rows, manual, confirmed, index, newProducts, skipped]);

  function changeMapping(next: InputMapping) {
    setMapping(next);
    setRows([]); setResults([]); setManual({}); setConfirmed({});
    setNewProducts({}); setSkipped({}); setExportFormat(null);
    setDiffRow(null); setPickerRow(null); setLastExport(null);
    setError('列映射已更改，请重新点击“开始匹配”，再核对并导出。');
  }

  const preview = useMemo(() => {
    if (!workbook || !mapping.model) {
      return {
        rows: [] as RawInboundRow[],
        ignoredHeaderRows: 0,
        ignoredEmptyModelRows: 0,
        missingQty: 0,
        missingPrice: 0,
      };
    }
    try {
      const analysis = analyzeInboundRows(workbook, mapping, adapter.label);
      return {
        rows: analysis.rows,
        ignoredHeaderRows: analysis.ignoredHeaderRows,
        ignoredEmptyModelRows: analysis.ignoredEmptyModelRows,
        missingQty: analysis.rows.filter((row) => row.qty === 0).length,
        missingPrice: analysis.rows.filter((row) => row.price === 0).length,
      };
    } catch {
      return {
        rows: [] as RawInboundRow[],
        ignoredHeaderRows: 0,
        ignoredEmptyModelRows: workbook.rows.length,
        missingQty: 0,
        missingPrice: 0,
      };
    }
  }, [workbook, mapping, adapter]);

  const fileBrands = useMemo(() => {
    const brands = new Set<string>();
    preview.rows.forEach((row) => {
      if (row.brand) brands.add(row.brand);
    });
    return [...brands];
  }, [preview.rows]);

  const unsupportedBrands = useMemo(
    () =>
      fileBrands.filter(
        (brand) =>
          !adapter.brandAliases.some(
            (alias) => normalizeBrand(alias) === normalizeBrand(brand),
          ),
      ),
    [fileBrands, adapter],
  );

  const hasBlockingIssue = useMemo(() => {
    if (!workbook) return false;
    return (
      workbook.sectionTitles.length > 1 ||
      unsupportedBrands.length > 0 ||
      !mapping.model ||
      !mapping.qty || !mapping.price
    );
  }, [workbook, unsupportedBrands, mapping.model, mapping.qty, mapping.price]);

  const priceHeaders = useMemo(() => {
    const headers = (workbook?.headers ?? []).filter((header) =>
      /^(底价|价格|单价)$/.test(header),
    );
    if (mapping.price && !headers.includes(mapping.price)) headers.push(mapping.price);
    return headers;
  }, [workbook, mapping.price]);

  const rowsByNumber = useMemo(() => {
    const map = new Map<number, RawInboundRow>();
    rows.forEach((row) => map.set(row.rowNumber, row));
    return map;
  }, [rows]);

  const resolvedMap = useMemo(() => {
    const map = new Map<number, { code: string; name: string; spec: string; unit: string }>();
    effectiveResults.forEach((result) => {
      if (result.status === 'matched' && result.product) {
        map.set(result.trace.rowNumber, {
          code: result.product.code,
          name: result.product.name,
          spec: result.product.spec,
          unit: result.product.unit,
        });
      }
    });
    return map;
  }, [effectiveResults]);

  const summary = useMemo(() => {
    const matched = effectiveResults.filter((result) => result.status === 'matched').length;
    const review = effectiveResults.filter((result) => result.status === 'review').length;
    const unmatched = effectiveResults.filter((result) => result.status === 'unmatched').length;
    const unsupported = effectiveResults.filter((result) =>
      result.reason?.includes('尚未配置匹配规则'),
    ).length;
    const parseErrors = effectiveResults.filter((result) =>
      result.reason?.startsWith('无法解析型号'),
    ).length;
    const needsConfirmation = pendingRows(effectiveResults, newProducts, skipped);
    return {
      total: effectiveResults.length,
      matched,
      review,
      unmatched,
      unresolved: review + unmatched,
      needsConfirmation,
      unsupported,
      parseErrors,
    };
  }, [effectiveResults, newProducts, skipped]);

  const diffs = useMemo(() => {
    const map = new Map<number, TireDiff>();
    if (!index) return map;
    effectiveResults.forEach((result) => {
      if (!result.parsed || !result.product) return;
      const productParsed = index.parsedProducts.get(result.product.code);
      if (productParsed) {
        map.set(result.trace.rowNumber, diffTire(result.parsed, productParsed));
      }
    });
    return map;
  }, [effectiveResults, index]);

  const reviewGroupByRow = useMemo(() => {
    const map = new Map<number, string>();
    effectiveResults.forEach((result) => {
      if (result.status !== 'review') return;
      const rowNumber = result.trace.rowNumber;
      if (result.method === 'core') {
        const diff = diffs.get(rowNumber);
        map.set(
          rowNumber,
          diff?.safeToBatchConfirm && diff.batchGroup
            ? `core:${diff.batchGroup}`
            : 'core:critical',
        );
      } else if (result.method === 'candidate') {
        map.set(rowNumber, 'candidate');
      } else {
        map.set(rowNumber, 'other');
      }
    });
    return map;
  }, [effectiveResults, diffs]);

  const reviewGroups = useMemo(() => {
    const groups = new Map<
      string,
      { key: string; label: string; rows: number[]; kind: 'core' | 'critical' | 'candidate' | 'other' }
    >();
    effectiveResults.forEach((result) => {
      if (result.status !== 'review') return;
      const rowNumber = result.trace.rowNumber;
      const key = reviewGroupByRow.get(rowNumber) ?? 'other';
      const diff = diffs.get(rowNumber);
      let label = '其他';
      let kind: 'core' | 'critical' | 'candidate' | 'other' = 'other';
      if (key === 'core:critical') {
        label = '关键差异，需逐条核对';
        kind = 'critical';
      } else if (key === 'candidate') {
        label = '有候选，需手动选择';
        kind = 'candidate';
      } else if (key.startsWith('core:')) {
        label = diff?.batchLabel ?? '可批量确认的差异';
        kind = 'core';
      }
      const group = groups.get(key) ?? { key, label, rows: [], kind };
      group.rows.push(rowNumber);
      groups.set(key, group);
    });
    const order = { core: 0, critical: 1, candidate: 2, other: 3 };
    return [...groups.values()].sort(
      (a, b) => order[a.kind] - order[b.kind] || b.rows.length - a.rows.length,
    );
  }, [effectiveResults, reviewGroupByRow, diffs]);

  useEffect(() => {
    if (filter !== 'review' || reviewGroup === 'all') return;
    if (!reviewGroups.some((group) => group.key === reviewGroup)) {
      setReviewGroup('all');
    }
  }, [filter, reviewGroup, reviewGroups]);

  const filteredResults = useMemo(() => {
    let list = effectiveResults;
    if (filter === 'review') list = list.filter((result) => result.status === 'review');
    else if (filter === 'importable') {
      list = list.filter((result) => result.status === 'matched');
    } else if (filter === 'blocked') {
      list = list.filter((result) => result.status === 'unmatched');
    }
    if (filter === 'review' && reviewGroup !== 'all') {
      list = list.filter(
        (result) => reviewGroupByRow.get(result.trace.rowNumber) === reviewGroup,
      );
    }
    return list;
  }, [effectiveResults, filter, reviewGroup, reviewGroupByRow]);

  const visibleBatchConfirmable = useMemo(
    () =>
      filteredResults.filter(
        (result) =>
          result.method === 'core' &&
          result.status === 'review' &&
          diffs.get(result.trace.rowNumber)?.safeToBatchConfirm,
      ).length,
    [filteredResults, diffs],
  );

  const totals = useMemo(() => {
    let sourceQty = 0;
    let sourceAmount = 0;
    let exportQty = 0;
    let exportAmount = 0;
    rows.forEach((row) => {
      if (Number.isFinite(row.qty)) sourceQty += row.qty;
      if (Number.isFinite(row.qty * row.price)) sourceAmount += row.qty * row.price;
      if (resolvedMap.has(row.rowNumber)) {
        exportQty += row.qty;
        exportAmount += row.qty * row.price;
      }
    });
    return {
      sourceQty,
      sourceAmount,
      exportQty,
      exportAmount,
      skippedQty: sourceQty - exportQty,
      skippedAmount: sourceAmount - exportAmount,
    };
  }, [rows, resolvedMap]);

  const selectedDiff = diffRow !== null ? diffs.get(diffRow) : undefined;
  const selectedDiffResult = diffRow !== null
    ? effectiveResults.find((result) => result.trace.rowNumber === diffRow)
    : undefined;

  const pickerProduct = useMemo(() => {
    if (pickerRow === null || !index) return undefined;
    const code =
      manual[pickerRow] ??
      effectiveResults.find((result) => result.trace.rowNumber === pickerRow)?.product?.code;
    return code ? index.byCode.get(code) : undefined;
  }, [pickerRow, manual, effectiveResults, index]);

  async function handleFile(file: File) {
    if (!adapter) return;
    if (!catalog) {
      setError('商品目录还没加载完成，请稍后再试');
      return;
    }
    setBusy(true);
    setError('');
    logger.start({
      appVersion: __APP_VERSION__,
      commitSha: __COMMIT_SHA__,
      adapterId: adapter.id,
      adapterVersion: adapter.version,
      catalogVersion: catalog.version,
      fileName: file.name,
    });
    try {
      const parsed = await readInboundWorkbook(file, adapter);
      setWorkbook(parsed);
      setMapping(parsed.mapping);
      setRows([]);
      setResults([]);
      setManual({});
      setConfirmed({});
      setNewProducts({});
      setSkipped({});
      setFilter('all');
      setReviewGroup('all');
      setShowMapping(false);
      setDiffRow(null);
      setExportFormat(null);
      setLastExport(null);
      logger.event('info', 'file_loaded', {
        fileName: file.name,
        sheetName: parsed.sheetName,
        headerRow: parsed.headerRowIndex + 1,
        headers: parsed.headers,
        mapping: parsed.mapping,
        rows: parsed.rows.length,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logger.event('error', 'file_parse_error', {
        fileName: file.name,
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function runMatch() {
    if (!adapter || !workbook || !index) return;
    if (!mapping.model) {
      setError('请选择“型号/规格”列');
      return;
    }
    if (!mapping.qty || !mapping.price) {
      setError('请选择“数量”和“单价”列');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const inboundRows = buildInboundRows(workbook, mapping, adapter.label);
      if (!inboundRows.length) throw new Error('没有可匹配的数据行');
      const nextResults = inboundRows.map((row) => {
        const rowBrand = normalizeBrand(row.brand);
        const isSelectedBrand = adapter.brandAliases.some(
          (alias) => normalizeBrand(alias) === rowBrand,
        );
        if (row.brand && !isSelectedBrand) {
          return unsupportedBrandResult(row.rowNumber, row.model, row.brand);
        }
        const brand = mapping.brand ? String(row.source[mapping.brand] ?? '').trim() : '';
        return resolveResult(matchRow(row.rowNumber, row.model, adapter, index, aliases, brand || undefined), row, index);
      });
      nextResults.forEach((result) => {
        logger.event(result.status === 'matched' ? 'info' : 'warn', 'match_row', {
          row: result.trace.rowNumber,
          rawModel: result.trace.rawModel,
          parsed: result.trace.parsed,
          status: result.status,
          method: result.method,
          matchedCode: result.trace.matchedCode,
          warning: result.trace.warning,
          reason: result.trace.reason,
          candidates: result.trace.candidates,
        });
      });
      setRows(inboundRows);
      setResults(nextResults);
      setBackupRevision(value => value + 1);
      setManual({});
      setConfirmed({});
      setNewProducts({});
      setSkipped({});
      setFilter('all');
      setReviewGroup('all');
      setDiffRow(null);
      setExportFormat(null);
      setLastExport(null);
      const matched = nextResults.filter((result) => result.status === 'matched').length;
      const review = nextResults.filter((result) => result.status === 'review').length;
      const unmatched = nextResults.filter((result) => result.status === 'unmatched').length;
      logger.finish(nextResults.map((result) => result.trace), {
        total: inboundRows.length,
        matched,
        review,
        unmatched,
        exported: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logger.event('error', 'match_error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
        mapping,
      });
    } finally {
      setBusy(false);
    }
  }

  function selectProduct(rowNumber: number, product: Product) {
    const result = results.find((item) => item.trace.rowNumber === rowNumber);
    const row = rows.find(item => item.rowNumber === rowNumber);
    if (!row || validateInboundRow(row).length) { setError('请先修正此行数量或单价，再重新上传匹配。'); return; }
    const productParsed = index?.parsedProducts.get(product.code);
    if (result?.parsed && productParsed && !samePatternFamily(result.parsed.pattern, productParsed.pattern)) {
      setError(`基础花纹不同，不能对应此商品：厂家 ${result.parsed.pattern}，商品 ${productParsed.pattern}。请检查正确商品是否已建档。`);
      return;
    }
    const comparison = result?.parsed && productParsed ? diffTire(result.parsed, productParsed) : null;
    const issues = [...(productParsed?.issues ?? []),
      ...(result?.parsed?.issues ?? []),
      ...(result?.parsed?.unrecognized ? [`厂家未识别内容：${result.parsed.unrecognized}`] : []),
      ...(productParsed?.unrecognized ? [`商品未识别内容：${productParsed.unrecognized}`] : []),
    ];
    if (!result?.parsed || !productParsed) issues.push('系统无法验证花纹，本次对应完全依赖人工核对');
    if ((comparison?.hasCritical || issues.length || !result?.parsed || !productParsed)
      && !window.confirm(`请核对本次人工选择：\n厂家型号：${result?.trace.rawModel ?? ''}\n商品规格：${product.spec}\n${[comparison?.summary, ...issues].filter(Boolean).join('；')}\n确认对应此商品并保存记忆吗？`)) return;
    const aliasKey = result ? makeAliasKey(result.trace.rawModel) : '';
    if (aliasKey) {
      const next = { ...aliases, [aliasKey]: rememberAlias(result!.trace.rawModel, product, adapter, result?.parsed?.brand) };
      setAliases(next);
      if (adapter) saveAliases(adapter, next);
    }
    setSkipped(prev => ({ ...prev, [rowNumber]: false }));
    setManual((prev) => ({ ...prev, [rowNumber]: product.code }));
    setNewProducts(prev => ({ ...prev, [rowNumber]: false }));
    logger.event('info', 'manual_select', {
      row: rowNumber,
      rawModel: result?.trace.rawModel,
      code: product.code,
      aliasKey,
    });
    setPickerRow(null);
  }

  function clearManual(rowNumber: number) {
    const result = results.find((item) => item.trace.rowNumber === rowNumber);
    const aliasKey = result ? makeAliasKey(result.trace.rawModel) : '';
    if (result) {
      const next = forgetAlias(result.trace.rawModel, result.parsed, aliases);
      setAliases(next); saveAliases(adapter, next);
      if (index) setResults(prev => prev.map(item => item.trace.rowNumber === rowNumber
        ? matchRow(rowNumber, item.trace.rawModel, adapter, index, next, item.parsed?.brand) : item));
    }
    setManual((prev) => {
      const next = { ...prev };
      delete next[rowNumber];
      return next;
    });
    if (result?.method === 'core') {
      setConfirmed((prev) => {
        const next = { ...prev };
        delete next[rowNumber];
        return next;
      });
    }
    logger.event('info', 'manual_clear', { row: rowNumber, aliasKey });
  }

  function toggleConfirm(rowNumber: number) {
    const row = rows.find(item => item.rowNumber === rowNumber);
    if (!row || validateInboundRow(row).length) { setError('请先修正数量或单价，再重新上传匹配。'); return; }
    if (!confirmed[rowNumber]) rememberConfirmedRows([rowNumber]);
    else {
      const result = results.find(item => item.trace.rowNumber === rowNumber);
      if (result) {
        const next = forgetAlias(result.trace.rawModel, result.parsed, aliases);
        setAliases(next); saveAliases(adapter, next);
      }
    }
    setConfirmed((prev) => {
      const next = { ...prev };
      if (next[rowNumber]) delete next[rowNumber];
      else next[rowNumber] = true;
      return next;
    });
    logger.event('info', 'core_confirm_toggle', {
      row: rowNumber,
      confirmed: !confirmed[rowNumber],
    });
  }

  function changeFilter(next: 'all' | 'review' | 'importable' | 'blocked') {
    setFilter(next);
    setReviewGroup('all');
  }

  function confirmRows(rowNumbers: number[]) {
    if (!rowNumbers.length) return;
    rememberConfirmedRows(rowNumbers);
    setConfirmed((prev) => {
      const next = { ...prev };
      rowNumbers.forEach((rowNumber) => {
        next[rowNumber] = true;
      });
      return next;
    });
    logger.event('info', 'core_confirm_rows', { rows: rowNumbers });
  }

  function rememberConfirmedRows(rowNumbers: number[]) {
    const next = { ...aliases };
    for (const rowNumber of rowNumbers) {
      const result = results.find(item => item.trace.rowNumber === rowNumber);
      const row = rows.find(row => row.rowNumber === rowNumber);
      if (result?.product && row && !validateInboundRow(row).length) next[makeAliasKey(result.trace.rawModel)] = rememberAlias(
        result.trace.rawModel, result.product, adapter, result.parsed?.brand,
      );
    }
    setAliases(next);
    saveAliases(adapter, next);
  }

  function confirmVisibleBatch() {
    const rowNumbers = filteredResults
      .filter(
        (result) =>
          result.method === 'core' &&
          result.status === 'review' &&
          !manual[result.trace.rowNumber] &&
          !confirmed[result.trace.rowNumber] &&
          diffs.get(result.trace.rowNumber)?.safeToBatchConfirm,
      )
      .map((result) => result.trace.rowNumber);
    confirmRows(rowNumbers);
  }

  function openExportModal(format: 'xlsx' | 'xls') {
    if (!adapter) return;
    if (summary.needsConfirmation > 0) {
      setError('仍有未处理行，请对应商品、标记待新建，或明确选择本次跳过。');
      return;
    }
    if (resolvedMap.size === 0) {
      setError('没有可导出的行，请先完成匹配');
      return;
    }
    setExportFormat(format);
  }

  function performDownload() {
    if (!adapter || !catalog || !exportFormat || !workbook) return;
    if (summary.needsConfirmation > 0) { setError('仍有未处理行，请返回核对。'); setExportFormat(null); return; }
    let exportRows;
    try { exportRows = buildImportRows(rows, resolvedMap, supplierName, new Set(rows.filter(row => newProducts[row.rowNumber] || skipped[row.rowNumber]).map(row => row.rowNumber))); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); setExportFormat(null); return; }
    if (!exportRows.length) {
      setError('没有可导出的行，请先完成匹配');
      return;
    }
    const format = exportFormat;
    const fileName = `入库导入_${adapter.label}_${todayText()}.${format}`;
    const workbookFile = createImportWorkbook(exportRows);
    downloadWorkbook(workbookFile, fileName, format);
    setBackupRevision(value => value + 1);
    logger.event('info', 'export_import', {
      format,
      rows: exportRows.length,
      unresolved: rows.length - exportRows.length,
      quantity: totals.exportQty,
      amount: totals.exportAmount,
      priceField: mapping.price,
    });
    setLastExport({ fileName, rows: exportRows.length });
    setExportFormat(null);
    setError('');
    setHistory(
      addHistory({
        fileName: workbook.fileName,
        brand: adapter.label,
        total: summary.total,
        imported: resolvedMap.size,
        review: summary.review,
        unmatched: summary.unmatched,
        quantity: totals.exportQty,
        amount: totals.exportAmount,
        format,
        priceField: mapping.price,
        catalogVersion: catalog.version,
        appVersion: __APP_VERSION__,
        commitSha: __COMMIT_SHA__,
      }),
    );
  }

  function resetAll() {
    setWorkbook(null);
    setMapping(EMPTY_MAPPING);
    setRows([]);
    setResults([]);
    setManual({});
    setConfirmed({});
    setNewProducts({});
    setSkipped({});
    setFilter('all');
    setReviewGroup('all');
    setShowMapping(false);
    setDiffRow(null);
    setExportFormat(null);
    setLastExport(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function downloadReport() {
    if (!adapter || !catalog) return;
    const report = createReportWorkbook(
      effectiveResults.map((result) => result.trace),
      catalog.version,
    );
    downloadWorkbook(report, `匹配报告_${adapter.label}_${todayText()}.xlsx`, 'xlsx');
    logger.event('info', 'export_report', { rows: effectiveResults.length });
  }

  function downloadNewProducts() {
    if (!newProductRows.length) return;
    downloadWorkbook(createNewProductWorkbook(newProductRows, supplierName, mapping.price), `待新建商品清单_${todayText()}.xlsx`);
    setBackupRevision(value => value + 1);
  }

  function downloadBlank() {
    downloadWorkbook(createBlankInboundWorkbook(), '厂家进库数据_空白表头.xlsx', 'xlsx');
  }

  function downloadSample() {
    if (!adapter) return;
    const sample = createSampleInboundWorkbook(adapter);
    downloadWorkbook(sample, '厂家进库数据_示例.xlsx', 'xlsx');
  }

  if (!adapter) {
    return <main className="app"><p>没有可用的品牌适配器。</p></main>;
  }

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">厂家进库 · 自动匹配</p>
          <h1>轮胎入库匹配工具</h1>
          <p className="hero-copy">
            上传本日厂家进库 Excel，浏览器本地完成型号解析、商品匹配和导入模板生成。数据不会上传到服务器。
          </p>
        </div>
        <div className="version-box">
          <button
            type="button"
            className="help-button"
            onClick={() => setHelpOpen(true)}
          >
            帮助 / 教程
          </button>
          <span>v{__APP_VERSION__}</span>
          <span>{__COMMIT_SHA__.slice(0, 7)}</span>
          {catalog && <span>目录 {catalog.version}</span>}
        </div>
      </header>

      <main className="layout">
        <section className="card">
          <div className="section-heading">
            <span className="step">01</span>
            <div>
              <h2>上传本日入库文件</h2>
              <p className="muted">
                这里上传的是<strong>厂家给的本日进库数据</strong>，不是商品资料。商品资料在页面底部维护。
              </p>
            </div>
          </div>

          <div className="upload-guide">
            <div className="upload-guide-title">上传前请先在 Excel 里整理好</div>
            <p>
              <strong>这个工具按“干净文件”设计，不做复杂清洗。</strong>
              文件不符合要求时会被拦截，请先处理再上传。
            </p>
            <ol className="upload-checklist">
              <li>只保留<strong>一行表头</strong>和<strong>本日需要入库的商品行</strong>。</li>
              <li>删除其他日期、其他供应商的品牌行、合计行、备注行。海大和天府可放在同一文件中。</li>
              <li>保留下面这组字段；列名不完全一样也可以，下一步能手动映射。</li>
            </ol>
            <div className="header-chips" aria-label="标准表头">
              {['序号', '品牌', '规格', '单位', '价格', '数量', '金额', '当期', '规模', '促销', '现金', '底价', '付款'].map((header) => (
                <span key={header}>{header}</span>
              ))}
            </div>
            <div className="upload-guide-actions">
              <span>最稳的做法：下载空白表头，把本日商品行粘进去。</span>
              <div className="guide-buttons">
                <button type="button" className="link-button" onClick={downloadBlank}>
                  下载空白表头
                </button>
                <button type="button" className="link-button" onClick={downloadSample}>
                  下载示例文件
                </button>
              </div>
            </div>
          </div>

          <div className="form-row">
            <label htmlFor="brand">供应商</label>
            <select
              id="brand"
              value={brandId}
              onChange={(event) => setBrandId(event.target.value)}
            >
              {brandAdapters.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.supplierName}
                </option>
              ))}
            </select>
          </div>

          <div
            className={`dropzone ${busy ? 'disabled' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            onClick={() => !busy && fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              hidden
            />
            <strong>{busy ? '读取中…' : '点击选择本日入库 Excel，或把文件拖到这里'}</strong>
            <span>支持 .xlsx / .xls / .csv；程序只读取第一个工作表</span>
          </div>

          {catalogError && <div className="alert error">{catalogError}</div>}
          {error && <div className="alert error">{error}</div>}

          {workbook && (
            <>
              <div className="file-summary">
                <span className="file-name">{workbook.fileName}</span>
                <span>工作表：{workbook.sheetName}</span>
                <span>表头：第 {workbook.headerRowIndex + 1} 行</span>
                <span>数据行：{workbook.rows.length}</span>
                {fileBrands.length > 0 && <span>品牌：{fileBrands.join('、')}</span>}
              </div>

              {workbook.sectionTitles.length > 1 && (
                <div className="alert error">
                  文件里检测到 {workbook.sectionTitles.length} 个出库区块：
                  {workbook.sectionTitles
                    .map((section) => `第 ${section.rowNumber} 行「${section.text}」`)
                    .join('、')}
                  。请只保留本日区块，删除其他日期区块后重新上传。
                </div>
              )}

              {unsupportedBrands.length > 0 && (
                <div className="alert error">
                  文件里检测到不属于当前供应商配置的品牌：{unsupportedBrands.join('、')}。
                  {adapter.supplierName}目前支持海大、天府，请先删除其他品牌的行后重新上传。
                </div>
              )}

              {workbook.sheetNames.length > 1 && (
                <div className="alert warn">
                  这个文件有 {workbook.sheetNames.length} 个工作表，当前只读取第一个「{workbook.sheetName}」。
                  请确认本日入库数据在第一个工作表，或者先拆分文件。
                </div>
              )}

              {mapping.model && preview.ignoredEmptyModelRows > 0 && (
                <div className="alert warn">
                  有 {preview.ignoredEmptyModelRows} 行没有商品型号（可能是合计、备注或空行），匹配时会自动忽略。
                  如果这些不是这类行，请检查列映射。
                </div>
              )}

              {preview.rows.some(row => validateInboundRow(row).length > 0) && (
                <div className="alert error">
                  数量须为正整数，单价须大于 0。以下异常行不能导入，请修正原表后重新上传，或在匹配后明确跳过：
                  <ul>{preview.rows.filter(row => validateInboundRow(row).length).slice(0, 8).map(row => (
                    <li key={row.rowNumber}>第 {row.rowNumber} 行：{validateInboundRow(row).join('；')}</li>
                  ))}</ul>
                  异常行的合计仅包含可计算数值，不能作为完整订单合计。
                </div>
              )}

              {!hasBlockingIssue && !preview.rows.some(row => validateInboundRow(row).length) && (
                <div className="alert success">文件检查通过，可以开始匹配。</div>
              )}
            </>
          )}
        </section>

        {workbook && (
          <section className="card">
            <div className="section-heading">
              <span className="step">02</span>
              <div>
                <h2>确认字段</h2>
                <p className="muted">程序会自动识别；识别错了才需要调整。</p>
              </div>
            </div>

            <div className="mapping-summary">
              <div><span>型号列</span><strong>{mapping.model || '未识别'}</strong></div>
              <div><span>数量列</span><strong>{mapping.qty || '未识别'}</strong></div>
              <div><span>单位列</span><strong>{mapping.unit || '不填'}</strong></div>
              <div><span>品牌列</span><strong>{mapping.brand || '从型号识别（默认海大）'}</strong></div>
            </div>

            <div className="price-choice">
              <span>单价口径</span>
              {priceHeaders.length > 0 ? (
                priceHeaders.map((header) => (
                  <label
                    key={header}
                    className={mapping.price === header ? 'active' : ''}
                  >
                    <input
                      type="radio"
                      name="priceField"
                      checked={mapping.price === header}
                      onChange={() => changeMapping({ ...mapping, price: header })}
                    />
                    {header}
                  </label>
                ))
              ) : (
                <select
                  value={mapping.price}
                  onChange={(event) => changeMapping({ ...mapping, price: event.target.value })}
                >
                  <option value="">请选择</option>
                  {workbook.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="supplier-line">
              供应商：<strong>{supplierName}</strong>
              <span>（系统固定）</span>
            </div>
            {!!index?.skipped.length && (
              <div className="alert warn">
                当前供应商目录中有 {index.skipped.length} 条商品规格无法完整解析，未参与自动匹配。
                可能为现有规则未覆盖的型号或资料缺失，可人工选择并保存对应关系；SKU 不会补齐缺失型号。
              </div>
            )}

            {(!mapping.model || !mapping.qty || !mapping.price) && (
              <div className="alert error">
                没有识别到型号列或数量列，请点“调整映射”手动指定。
              </div>
            )}

            {showMapping && (
              <div className="mapping-grid">
                <div className="field">
                  <label>型号 / 规格列 *</label>
                  <select
                    value={mapping.model}
                    onChange={(event) => changeMapping({ ...mapping, model: event.target.value })}
                  >
                    <option value="">请选择</option>
                    {workbook.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>数量列 *</label>
                  <select
                    value={mapping.qty}
                    onChange={(event) => changeMapping({ ...mapping, qty: event.target.value })}
                  >
                    <option value="">请选择</option>
                    {workbook.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>单位列</label>
                  <select
                    value={mapping.unit}
                    onChange={(event) => changeMapping({ ...mapping, unit: event.target.value })}
                  >
                    <option value="">不填</option>
                    {workbook.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>品牌列</label>
                  <select
                    value={mapping.brand}
                    onChange={(event) => changeMapping({ ...mapping, brand: event.target.value })}
                  >
                    <option value="">不填（从型号识别，默认海大）</option>
                    {workbook.headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            <div className="step-actions">
              <button
                type="button"
                className="danger-button"
                onClick={() => setShowMapping((value) => !value)}
              >
                {showMapping ? '收起映射设置' : '调整映射'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void runMatch()}
                disabled={busy || !mapping.model || !mapping.qty || !index || hasBlockingIssue}
              >
                {hasBlockingIssue ? '请先整理文件' : busy ? '匹配中…' : '开始匹配'}
              </button>
            </div>
          </section>
        )}

        {results.length > 0 && (
          <>
            <section className="summary-grid">
              <div className="stat">
                <span>总行数</span>
                <strong>{summary.total}</strong>
              </div>
              <div className="stat matched-stat">
                <span>可导入</span>
                <strong>{summary.matched}</strong>
              </div>
              <div className="stat review-stat">
                <span>需确认</span>
                <strong>{summary.review}</strong>
              </div>
              <div className="stat unmatched-stat">
                <span>不可导入</span>
                <strong>{summary.unmatched}</strong>
              </div>
            </section>

            <section className="totals-card">
              <div className="total-item">
                <span>源文件商品行</span>
                <strong>{rows.length} 行</strong>
                <small>{totals.sourceQty} 条 / ¥{formatAmount(totals.sourceAmount)}</small>
              </div>
              <div className="total-item ok">
                <span>可导入</span>
                <strong>{resolvedMap.size} 行</strong>
                <small>{totals.exportQty} 条 / ¥{formatAmount(totals.exportAmount)}</small>
              </div>
              <div className={`total-item ${totals.skippedQty !== 0 ? 'warn' : ''}`}>
                <span>未导入</span>
                <strong>{rows.length - resolvedMap.size} 行</strong>
                <small>{totals.skippedQty} 条 / ¥{formatAmount(totals.skippedAmount)}</small>
              </div>
              <div className="total-note">
                金额按单价列“{mapping.price || '未选择'}”计算
              </div>
            </section>

            <section className="card">
              <div className="section-heading">
                <span className="step">03</span>
                <div>
                  <h2>核对并导出</h2>
                  <p className="muted">
                    只有唯一命中的行会自动匹配；核心字段匹配会标为“待核对”，必须确认后才能导出。
                  </p>
                </div>
              </div>

              {summary.needsConfirmation > 0 && (
                <div className="alert warn">
                  有 {summary.needsConfirmation} 行尚未处理。请对应商品、标记待新建，或明确选择“本次跳过”，再导出。
                </div>
              )}

              {summary.needsConfirmation === 0 && summary.unresolved > 0 && (
                <div className="alert warn">
                  有 {summary.unresolved} 行已标记待新建或本次跳过，不会写入本次入库模板。
                  {summary.unsupported > 0 && ` 其中 ${summary.unsupported} 行是未配置品牌。`}
                  {summary.parseErrors > 0 && ` ${summary.parseErrors} 行型号无法解析。`}
                </div>
              )}

              {lastExport && (
                <div className="alert success">
                  已生成 <strong>{lastExport.fileName}</strong>，包含 {lastExport.rows} 行。
                  <button type="button" className="link-button" onClick={resetAll}>
                    处理下一单
                  </button>
                </div>
              )}

              {newProductRows.length > 0 && <div className="alert warn">
                已标记 {newProductRows.length} 行待新建商品，本次入库模板会排除这些行。请下载清单，回系统新建后再更新目录、重新匹配。
              </div>}
              <div className="toolbar">
                {newProductRows.length > 0 && <button type="button" className="secondary" onClick={downloadNewProducts}>
                  下载待新建清单（{newProductRows.length}）
                </button>}
                <button
                  type="button"
                  className="primary"
                  onClick={() => openExportModal('xlsx')}
                  disabled={resolvedMap.size === 0 || summary.needsConfirmation > 0}
                >
                  下载导入模板 .xlsx
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => openExportModal('xls')}
                  disabled={resolvedMap.size === 0 || summary.needsConfirmation > 0}
                >
                  下载 .xls
                </button>
                <button type="button" className="secondary" onClick={downloadReport}>
                  下载匹配报告
                </button>
                <button type="button" className="link-button muted-link" onClick={resetAll}>
                  重新开始
                </button>
              </div>

              <div className="filter-tabs">
                <button
                  type="button"
                  className={filter === 'all' ? 'active' : ''}
                  onClick={() => changeFilter('all')}
                >
                  全部 <span>{summary.total}</span>
                </button>
                <button
                  type="button"
                  className={filter === 'review' ? 'active' : ''}
                  onClick={() => changeFilter('review')}
                >
                  需确认 <span>{summary.review}</span>
                </button>
                <button
                  type="button"
                  className={filter === 'importable' ? 'active' : ''}
                  onClick={() => changeFilter('importable')}
                >
                  可导入 <span>{summary.matched}</span>
                </button>
                <button
                  type="button"
                  className={filter === 'blocked' ? 'active' : ''}
                  onClick={() => changeFilter('blocked')}
                >
                  不可导入 <span>{summary.unmatched}</span>
                </button>
              </div>

              {filter === 'review' && (
                <div className="review-groups">
                  <div className="review-groups-title">需确认分类</div>
                  <div className="review-group-chips">
                    <button
                      type="button"
                      className={reviewGroup === 'all' ? 'active' : ''}
                      onClick={() => setReviewGroup('all')}
                    >
                      全部需确认 <span>{summary.review}</span>
                    </button>
                    {reviewGroups.map((group) => (
                      <button
                        type="button"
                        key={group.key}
                        className={`${reviewGroup === group.key ? 'active' : ''} ${group.kind}`}
                        onClick={() => setReviewGroup(group.key)}
                      >
                        {group.label} <span>{group.rows.length}</span>
                        <small>
                          {group.kind === 'core'
                            ? '可批量'
                            : group.kind === 'candidate'
                              ? '需选择'
                              : '逐条'}
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="review-group-note">
                    {reviewGroup === 'all'
                      ? '先选择一个分类，查看下方明细后再确认。'
                      : `当前分类：${reviewGroups.find((group) => group.key === reviewGroup)?.label ?? '全部'}。先核对下方明细，再确认。`}
                    {reviewGroup !== 'all' && visibleBatchConfirmable > 0 && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={confirmVisibleBatch}
                      >
                        确认本组可批量差异（{visibleBatchConfirmable}）
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>行号</th>
                      <th>厂家型号</th>
                      <th>数量</th>
                      <th>单价</th>
                      <th>状态</th>
                      <th>匹配商品信息</th>
                      <th>说明 / 候选</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((result) => {
                      const row = rowsByNumber.get(result.trace.rowNumber);
                      const status = skipped[result.trace.rowNumber] ? { label: '本次跳过', className: 'badge unmatched', detail: '已明确排除本次导入' } : statusInfo(result, newProducts[result.trace.rowNumber]);
                      const selectedCode = manual[result.trace.rowNumber] ?? result.product?.code;
                      return (
                        <tr key={result.trace.rowNumber} className={result.trace.rowNumber % 2 ? 'odd' : ''}>
                          <td className="row-number">{result.trace.rowNumber}</td>
                          <td>
                            <div className="model-cell">{result.trace.rawModel}</div>
                            {result.parsed && (
                              <div className="parsed-line">
                                {result.parsed.pattern} · {result.parsed.size}
                                {result.parsed.ply ? ` · ${result.parsed.ply}` : ''}
                                {result.parsed.loadSpeed ? ` · ${result.parsed.loadSpeed}` : ''}
                                {result.parsed.flags.length ? ` · ${result.parsed.flags.join('/')}` : ''}
                              </div>
                            )}
                          </td>
                          <td>{row && Number.isFinite(row.qty) ? row.qty : '无效'}</td>
                          <td>{row && Number.isFinite(row.price) ? row.price : '无效'}</td>
                          <td>
                            <span className={status.className}>{status.label}</span>
                            <div className="status-detail">{status.detail}</div>
                          </td>
                          <td>
                            {result.product ? (
                              <div className="product-cell">
                                <div className="product-spec-main">{result.product.spec}</div>
                                <div className="product-code-sub">SKU：{result.product.code}</div>
                              </div>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>
                            <div className="reason-line">
                              {result.reason ?? result.warning ?? methodLabel(result)}
                            </div>
                            {result.status !== 'matched' && result.candidates.length > 0 && (
                              <div className="candidate-row">
                                {result.candidates.slice(0, 3).map((candidate) => (
                                  <button
                                    type="button"
                                    key={candidate.product.code}
                                    className="candidate-chip"
                                    title={`${candidate.product.code} ${candidate.product.spec}`}
                                    onClick={() => selectProduct(result.trace.rowNumber, candidate.product)}
                                  >
                                    <span className="candidate-spec-main">{candidate.product.spec}</span>
                                    <small className="candidate-code-sub">{candidate.product.code}</small>
                                    <small className="candidate-difference">{candidate.reason}</small>
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="row-actions">
                              <button type="button" className="row-action" onClick={() => {
                                setSkipped(prev => ({ ...prev, [result.trace.rowNumber]: !prev[result.trace.rowNumber] }));
                                setNewProducts(prev => ({ ...prev, [result.trace.rowNumber]: false }));
                              }}>{skipped[result.trace.rowNumber] ? '取消跳过' : '本次跳过'}</button>
                              {(newProducts[result.trace.rowNumber] || (!result.product && result.reason?.includes('疑似未建档'))) && (
                                <button type="button" className="row-action" onClick={() => {
                                  setSkipped(prev => ({ ...prev, [result.trace.rowNumber]: false }));
                                  setNewProducts(prev => ({ ...prev, [result.trace.rowNumber]: !prev[result.trace.rowNumber] }));
                                  setFilter('all');
                                }}>{newProducts[result.trace.rowNumber] ? '取消待新建' : '标记待新建'}</button>
                              )}
                              {result.method === 'core' && !row?.validationErrors?.length && !skipped[result.trace.rowNumber] && !newProducts[result.trace.rowNumber] && (
                                <button
                                  type="button"
                                  className="row-action row-action-primary"
                                  onClick={() => toggleConfirm(result.trace.rowNumber)}
                                >
                                  {confirmed[result.trace.rowNumber] ? '撤销确认并删除记忆' : '确认核对'}
                                </button>
                              )}
                              {result.method === 'core' &&
                                result.product &&
                                (diffs.get(result.trace.rowNumber)?.reasons.length ?? 0) > 0 && (
                                  <button
                                    type="button"
                                    className="row-action"
                                    onClick={() => setDiffRow(result.trace.rowNumber)}
                                  >
                                    查看差异
                                  </button>
                                )}
                              <button
                                type="button"
                                className={`row-action ${selectedCode ? '' : 'row-action-primary'}`}
                                onClick={() => setPickerRow(result.trace.rowNumber)}
                              >
                                {selectedCode ? '改选' : '选择商品'}
                              </button>
                              {manual[result.trace.rowNumber] && (
                                <button
                                  type="button"
                                  className="row-action row-action-muted"
                                  onClick={() => clearManual(result.trace.rowNumber)}
                                >
                                  清除选择并删除记忆
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredResults.length === 0 && (
                      <tr>
                        <td colSpan={8} className="empty">
                          当前筛选条件下没有数据
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      <CatalogAdmin
        currentCatalog={catalog ?? undefined}
        onCatalogReady={(nextCatalog) => setCatalog(nextCatalog)}
      />

      <TutorialAdmin tutorials={tutorials} onChange={setTutorials} />

      <MappingManager
        aliases={aliases}
        products={index?.products ?? []}
        adapterLabel={adapter.label}
        adapterId={adapter.id}
        backupRevision={backupRevision}
        onChange={(next) => {
          setAliases(next);
          saveAliases(adapter, next);
          setResults([]); setManual({}); setConfirmed({}); setNewProducts({}); setSkipped({}); setExportFormat(null);
          setError('映射记忆已更改，请重新匹配。');
          logger.event('info', 'aliases_changed', { count: Object.keys(next).length });
        }}
      />

      <RecentHistory entries={history} onClear={() => setHistory([])} />

      <footer className="footer">
        <div>
          <strong>诊断与版本</strong>
          <span>v{__APP_VERSION__} · commit {__COMMIT_SHA__.slice(0, 7)}</span>
          {catalog && <span>商品目录 {catalog.version}</span>}
        </div>
        <div className="footer-actions">
          <button type="button" className="link-button" onClick={() => setHelpOpen(true)}>
            帮助 / 教程
          </button>
          <button type="button" className="link-button" onClick={downloadDiagnostics}>
            下载诊断日志
          </button>
          <button
            type="button"
            className="link-button muted-link"
            onClick={() => {
              logger.clear();
              setError('本地诊断日志已清空');
            }}
          >
            清空日志
          </button>
        </div>
      </footer>

      <HelpDialog
        open={helpOpen}
        tutorials={tutorials}
        onClose={() => setHelpOpen(false)}
      />

      <ProductPicker
        open={pickerRow !== null}
        products={index?.products ?? []}
        selectedCode={pickerProduct?.code}
        onSelect={(product) => {
          if (pickerRow !== null) selectProduct(pickerRow, product);
        }}
        onClose={() => setPickerRow(null)}
      />

      <DiffDialog
        open={diffRow !== null}
        rawModel={selectedDiffResult?.trace.rawModel ?? ''}
        productCode={selectedDiffResult?.product?.code}
        productSpec={selectedDiffResult?.product?.spec}
        diff={selectedDiff}
        confirmed={diffRow !== null ? Boolean(confirmed[diffRow]) : false}
        onConfirm={() => {
          if (diffRow !== null) toggleConfirm(diffRow);
        }}
        onReselect={() => {
          if (diffRow !== null) {
            setPickerRow(diffRow);
            setDiffRow(null);
          }
        }}
        onClose={() => setDiffRow(null)}
      />

      <ExportConfirmDialog
        open={exportFormat !== null}
        format={exportFormat}
        exportRows={resolvedMap.size}
        skippedRows={rows.length - resolvedMap.size}
        quantity={totals.exportQty}
        amount={totals.exportAmount}
        priceField={mapping.price}
        supplierName={supplierName}
        newProductModels={newProductRows.map(row => row.model)}
        skippedModels={rows.filter(row => skipped[row.rowNumber]).map(row => `第 ${row.rowNumber} 行：${row.model}`)}
        onDownloadNewProducts={downloadNewProducts}
        onConfirm={performDownload}
        onClose={() => setExportFormat(null)}
      />
    </div>
  );
}
