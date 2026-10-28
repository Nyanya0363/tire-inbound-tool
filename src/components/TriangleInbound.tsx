import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalog } from '../core/catalog';
import { createImportWorkbook, downloadWorkbook } from '../core/excel';
import { addHistory, loadHistory } from '../core/history';
import type { Catalog, Product } from '../core/types';
import { CatalogAdmin } from './CatalogAdmin';
import { ExportConfirmDialog } from './ExportConfirmDialog';
import { ProductPicker } from './ProductPicker';
import { RecentHistory } from './RecentHistory';
import {
  TRIANGLE_HEADERS, TRIANGLE_MEMORY_KEY, TRIANGLE_SUPPLIER, buildTriangleImport, matchTriangle,
  readTriangleMemories, readTriangleWorkbook, resolveTriangle, triangleDescriptionDifferences,
  triangleMemoryKey, triangleRows, triangleSelectableProducts, triangleTable,
} from '../brands/triangle/inbound';
import type { TriangleDecision, TriangleMapping, TriangleMemories, TriangleResult, TriangleWorkbook } from '../brands/triangle/inbound';
import './TriangleInbound.css';

const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function initialMemories(): TriangleMemories {
  try { return readTriangleMemories(JSON.parse(localStorage.getItem(TRIANGLE_MEMORY_KEY) ?? '{}')); } catch { return {}; }
}

export function TriangleInbound({ onHaida }: { onHaida: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [book, setBook] = useState<TriangleWorkbook | null>(null);
  const [mapping, setMapping] = useState<TriangleMapping | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [date, setDate] = useState('');
  const [results, setResults] = useState<TriangleResult[]>([]);
  const [decisions, setDecisions] = useState<Record<number, TriangleDecision>>({});
  const [memories, setMemories] = useState(initialMemories);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'xls' | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const [review, setReview] = useState<{ rowNumber: number; product: Product } | null>(null);
  const [lastExport, setLastExport] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSequence = useRef(0);
  useEffect(() => { loadCatalog().then(setCatalog).catch(err => setError(errorText(err))); }, []);

  function invalidate() {
    setResults([]); setDecisions({}); setFormat(null); setPicker(null); setReview(null); setLastExport('');
  }
  function saveMemories(next: TriangleMemories) {
    setMemories(next);
    try { localStorage.setItem(TRIANGLE_MEMORY_KEY, JSON.stringify(next)); }
    catch { setError('当前核对已生效，但浏览器无法保存记忆；下次使用时需重新核对。'); }
  }
  const analysis = useMemo(() => {
    try { return { rows: book && mapping ? triangleRows(book, mapping) : [], error: '' }; }
    catch (err) { return { rows: [], error: errorText(err) }; }
  }, [book, mapping]);
  const dates = [...new Set(analysis.rows.map(row => row.date))].sort();
  const visible = analysis.rows.filter(row => !date || row.date === date);
  const selectedRows = analysis.rows.filter(row => selected.has(row.rowNumber));
  const selectableProducts = useMemo(() => catalog ? triangleSelectableProducts(catalog) : [], [catalog]);
  const effective = results.map(result => resolveTriangle(result, decisions[result.row.rowNumber]));
  const included = effective.filter(result => !['skip', 'new'].includes(decisions[result.row.rowNumber]?.kind));
  const pending = included.filter(result => result.status !== 'matched');
  const ready = included.filter(result => result.status === 'matched');
  const totalQty = ready.reduce((sum, result) => sum + result.row.qty, 0);
  const totalAmount = ready.reduce((sum, result) => sum + result.row.qty * result.row.price, 0);
  const newRows = results.filter(result => decisions[result.row.rowNumber]?.kind === 'new');
  const skipped = results.filter(result => decisions[result.row.rowNumber]?.kind === 'skip');
  const reviewRow = results.find(result => result.row.rowNumber === review?.rowNumber)?.row;

  async function upload(file: File) {
    const sequence = ++uploadSequence.current;
    invalidate(); setBook(null); setMapping(null); setSelected(new Set()); setDate(''); setError(''); setBusy(true);
    try {
      const next = await readTriangleWorkbook(file);
      if (sequence === uploadSequence.current) { setBook(next); setMapping(next.mapping); }
    } catch (err) { if (sequence === uploadSequence.current) setError(errorText(err)); }
    finally { if (sequence === uploadSequence.current) setBusy(false); }
  }
  function runMatch() {
    if (!catalog || !selectedRows.length || analysis.error) return;
    invalidate(); setError('');
    setResults(selectedRows.map(row => matchTriangle(row, catalog, memories)));
  }
  function setDecision(rowNumber: number, decision: TriangleDecision) {
    setDecisions(prev => ({ ...prev, [rowNumber]: decision })); setFormat(null); setLastExport('');
  }
  function clearDecision(result: TriangleResult) {
    const next = { ...decisions }; delete next[result.row.rowNumber]; setDecisions(next);
    const saved = { ...memories }; delete saved[triangleMemoryKey(result.row)]; saveMemories(saved);
    // Re-evaluate every identical source row so removed memory cannot survive in another row.
    if (catalog) setResults(prev => prev.map(item => matchTriangle(item.row, catalog, saved)));
    setFormat(null); setLastExport('');
  }
  function confirmProduct() {
    if (!review || !reviewRow || !catalog) return;
    const base = results.find(result => result.row.rowNumber === review.rowNumber);
    if (!base?.canChoose || !selectableProducts.some(p => p === review.product)) return;
    setDecision(review.rowNumber, { kind: 'product', product: review.product });
    saveMemories({ ...memories, [triangleMemoryKey(reviewRow)]: {
      sourceCode: reviewRow.model, description: reviewRow.description, product: review.product,
    } });
    setReview(null);
  }
  function downloadNew() {
    downloadWorkbook(triangleTable(['源行号', '供应商', '厂家产品编号', '产品描述', '发货日期', '数量', '单价', '说明'],
      newRows.map(({ row }) => [row.rowNumber, TRIANGLE_SUPPLIER, row.model, row.description, row.date, row.qty, row.price,
        '回业务系统建档，更新商品目录后重新匹配；本行未导入']), '待新建商品'), '三角_待新建商品.xlsx');
  }
  function downloadReport() {
    downloadWorkbook(triangleTable(['源行号', '产品编号', '产品描述', '发货日期', '数量', '单价', '处理结果', '对应商品编号', '目录规格', '说明', '目录版本'],
      effective.map(result => {
        const disposition = decisions[result.row.rowNumber]?.kind;
        const excluded = disposition === 'skip' || disposition === 'new';
        return [result.row.rowNumber, result.row.model, result.row.description, result.row.date, result.row.qty, result.row.price,
          disposition === 'skip' ? '本次跳过' : disposition === 'new' ? '待新建' : result.status === 'matched' ? '可导入' : '待处理',
          excluded ? '' : result.product?.code ?? '', excluded ? '' : result.product?.spec ?? '',
          excluded ? '本行不写入入库模板' : result.reason, catalog?.version ?? ''];
      }), '匹配报告'), '三角_匹配报告.xlsx');
  }
  function exportFile() {
    if (!catalog || !format || !results.length) return;
    try {
      const output = buildTriangleImport(results, decisions, catalog);
      if (!output.length) throw new Error('没有可导出的商品行');
      const filename = `入库导入_三角_${new Date().toISOString().slice(0, 10)}.${format}`;
      downloadWorkbook(createImportWorkbook(output), filename, format);
      setLastExport(`已生成 ${filename}，共 ${output.length} 行`); setFormat(null);
      try {
        setHistory(addHistory({ fileName: book?.fileName ?? '', brand: '三角', total: results.length,
          imported: output.length, review: newRows.length, unmatched: skipped.length, quantity: totalQty,
          amount: totalAmount, format, priceField: mapping?.price ?? '', catalogVersion: catalog.version,
          appVersion: __APP_VERSION__, commitSha: __COMMIT_SHA__ }));
      } catch { setError('文件已生成，但浏览器无法保存处理记录。'); }
    } catch (err) { setError(errorText(err)); setFormat(null); }
  }
  function reset() {
    ++uploadSequence.current; invalidate(); setBook(null); setMapping(null); setSelected(new Set()); setDate(''); setError(''); setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
  }
  const validSourceQty = selectedRows.reduce((sum, row) => sum + (Number.isFinite(row.qty) ? row.qty : 0), 0);
  const validSourceAmount = selectedRows.reduce((sum, row) => sum + (Number.isFinite(row.qty * row.price) ? row.qty * row.price : 0), 0);

  return <div className="app triangle-app">
    <header className="hero"><div><p className="eyebrow">厂家进库 · 产品编号匹配</p><h1>轮胎入库匹配工具</h1>
      <p className="hero-copy">三角按产品编号匹配，价格直接作为入库单价。文件在浏览器本地处理。</p></div>
      <div className="version-box"><span>v{__APP_VERSION__}</span><span>{__COMMIT_SHA__.slice(0, 7)}</span></div></header>
    <main className="layout">
      <section className="card">
        <div className="form-row"><label htmlFor="triangle-supplier">供应商</label>
          <select id="triangle-supplier" value="triangle" onChange={event => { if (event.target.value === 'haida') onHaida(); }}>
            <option value="haida">四川海大轮胎橡胶集团股份有限公司</option><option value="triangle">{TRIANGLE_SUPPLIER}</option>
          </select></div>
        <h2>01 上传三角已发货订单</h2>
        <p>产品 → 商品编号；数量 → 入库数量；价格 → 入库单价。产品描述用于辅助核对。支持多个发货日期，下一步选择本次到货行。</p>
        <p className="muted">只读取第一个工作表。发货日期不代表实际入库日期；数量为本次整行入库数量，部分到货请先调整原表。切换供应商会清空当前处理结果。</p>
        <div className="header-chips">{TRIANGLE_HEADERS.map(header => <span key={header}>{header}</span>)}</div>
        <div className="toolbar"><button className="secondary" onClick={() => downloadWorkbook(triangleTable(TRIANGLE_HEADERS, [], 'Sheet1'), '三角_空白表头.xlsx')}>下载空白表头</button>
          <button className="secondary" onClick={() => downloadWorkbook(triangleTable(TRIANGLE_HEADERS,
            [['CBCTR92819F15DH0', '195/70R15C(TR928)104/102S 三角', 2, 218, '2026-10-18', '', '']], 'Sheet1'), '三角_示例_勿直接导入.xlsx')}>下载示例文件</button></div>
        <label className="dropzone" onDragOver={event => event.preventDefault()} onDrop={event => {
          event.preventDefault(); if (!busy && event.dataTransfer.files[0]) void upload(event.dataTransfer.files[0]);
        }}><strong>{busy ? '正在读取…' : '选择三角 Excel，或拖入文件'}</strong>
          <input ref={fileInput} aria-label="上传三角订单" type="file" accept=".xlsx,.xls,.csv" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
        {error && <p className="alert error" role="alert">{error}</p>}
        {!catalog && <p className="muted">商品目录尚未加载，加载完成后才能匹配。</p>}
      </section>
      {book && mapping && <section className="card">
        <h2>02 核对字段与本次入库范围</h2>
        <p>{book.fileName} · 工作表 {book.sheetName} · {book.rows.length} 行{book.sheetCount > 1 ? `（共 ${book.sheetCount} 个工作表，仅读取第一个）` : ''}</p>
        <div className="triangle-mapping">{(Object.keys(mapping) as Array<keyof TriangleMapping>).map(key => <label key={key}>
          {{ code: '产品编号列', description: '产品描述列', qty: '数量列', price: '单价列', date: '发货日期列' }[key]}
          <select aria-label={{ code: '产品编号列', description: '产品描述列', qty: '数量列', price: '单价列', date: '发货日期列' }[key]}
            value={mapping[key]} onChange={event => { setMapping({ ...mapping, [key]: event.target.value }); setSelected(new Set()); setDate(''); invalidate(); }}>
            <option value="">{key === 'description' || key === 'date' ? '不提供' : '请选择'}</option>
            {book.headers.map(header => <option key={header}>{header}</option>)}</select></label>)}</div>
        <p>单价直接取“{mapping.price || '未选择'}”，不扣减产品政策或优惠。</p>
        {analysis.error && <p className="alert error">{analysis.error}</p>}
        <div className="toolbar"><label>发货日期 <select aria-label="筛选发货日期" value={date} onChange={event => {
          setDate(event.target.value); setSelected(new Set()); invalidate();
        }}><option value="">全部日期</option>{dates.map(value => <option key={value}>{value}</option>)}</select></label>
          <button className="secondary" onClick={() => { setSelected(new Set(visible.map(row => row.rowNumber))); invalidate(); }}>选中当前日期范围全部行</button>
          <button className="secondary" onClick={() => { setSelected(new Set()); invalidate(); }}>清空选择</button></div>
        <p>已选 {selectedRows.length} / {analysis.rows.length} 行 · 数量 {validSourceQty} · 金额 ¥{money(validSourceAmount)}。切换日期会清空勾选。</p>
        {selectedRows.some(row => row.validationErrors?.length) && <p className="alert warn">已选行有异常，以上合计仅包含可计算数值；异常行须修正或明确跳过。</p>}
        <div className="table-wrap triangle-source"><table><thead><tr><th>入库</th><th>源行</th><th>产品 / 描述</th><th>发货日期</th><th>数量</th><th>价格</th></tr></thead>
          <tbody>{visible.map(row => <tr key={row.rowNumber}><td><input type="checkbox" aria-label={`选择第 ${row.rowNumber} 行`} checked={selected.has(row.rowNumber)}
            onChange={event => { const next = new Set(selected); if (event.target.checked) next.add(row.rowNumber); else next.delete(row.rowNumber); setSelected(next); invalidate(); }} /></td>
            <td>{row.rowNumber}</td><td><strong>{row.model || '编号为空'}</strong><div>{row.description}</div>
              <small className="muted">{['车牌号', '销售订单号', '产品政策', '政策类型'].filter(key => row.source[key]).map(key => `${key}：${String(row.source[key])}`).join(' · ')}</small>
              {!!row.validationErrors?.length && <small className="triangle-error">{row.validationErrors.join('；')}</small>}</td>
            <td>{row.date}</td><td>{Number.isFinite(row.qty) ? row.qty : '无效'}</td><td>{Number.isFinite(row.price) ? row.price : '无效'}</td></tr>)}</tbody></table></div>
        <div className="toolbar"><button className="primary" disabled={!catalog || !selectedRows.length || !!analysis.error || busy} onClick={runMatch}>开始匹配（{selectedRows.length} 行）</button></div>
      </section>}
      {results.length > 0 && <section className="card">
        <h2>03 核对结果并导出</h2>
        <p>可导入 {ready.length} 行 · 待处理 {pending.length} 行 · 待新建 {newRows.length} 行 · 本次跳过 {skipped.length} 行</p>
        <p>导出数量 {totalQty} · 导出金额 ¥{money(totalAmount)} · 与所选源行差额 ¥{money(validSourceAmount - totalAmount)}</p>
        <p className="muted">同编号的多行订单分别保留。所有待处理行须逐条核对、标记待新建或跳过后才能导出。</p>
        <div className="toolbar">{(['xlsx', 'xls'] as const).map(value => <button key={value} className="primary" disabled={pending.length > 0 || !ready.length} onClick={() => setFormat(value)}>下载导入模板 .{value}</button>)}
          <button className="secondary" onClick={downloadReport}>下载匹配报告</button>
          {!!newRows.length && <button className="secondary" onClick={downloadNew}>下载待新建清单</button>}
          <button className="secondary" onClick={reset}>重新开始</button></div>
        {lastExport && <p className="alert success">{lastExport}</p>}
        <div className="table-wrap"><table><thead><tr><th>源行</th><th>厂家编号 / 描述</th><th>数量 / 单价</th><th>状态与原因</th><th>目录商品</th><th>操作</th></tr></thead>
          <tbody>{effective.map(result => {
            const decision = decisions[result.row.rowNumber];
            const label = decision?.kind === 'skip' ? '本次跳过' : decision?.kind === 'new' ? '待新建' : result.status === 'matched' ? '可导入' : result.status === 'blocked' ? '不可导入' : '需确认';
            const product = result.product ?? result.candidate;
            return <tr key={result.row.rowNumber}><td>{result.row.rowNumber}</td><td><strong>{result.row.model}</strong><div>{result.row.description}</div></td>
              <td>{Number.isFinite(result.row.qty) ? result.row.qty : '无效'} / {Number.isFinite(result.row.price) ? result.row.price : '无效'}</td>
              <td><span className={`badge ${label === '可导入' ? 'matched' : 'review'}`}>{label}</span><div>{result.reason}</div></td>
              <td>{product ? <><strong>{product.code}</strong><div>{product.spec}</div><small>单位：{product.unit}</small></> : '—'}</td>
              <td><div className="row-actions">
                {result.canChoose && result.candidate && label === '需确认' && <button className="row-action" onClick={() => setReview({ rowNumber: result.row.rowNumber, product: result.candidate! })}>核对该商品</button>}
                {result.canChoose && <button className="row-action" onClick={() => setPicker(result.row.rowNumber)}>选择商品</button>}
                {result.canChoose && <button className="row-action" onClick={() => setDecision(result.row.rowNumber, { kind: 'new' })}>标记待新建</button>}
                <button className="row-action" onClick={() => setDecision(result.row.rowNumber, { kind: 'skip' })}>本次跳过</button>
                {(decision || memories[triangleMemoryKey(result.row)]) && <button className="row-action" onClick={() => clearDecision(result)}>撤销处理并删除记忆</button>}
              </div></td></tr>;
          })}</tbody></table></div>
      </section>}
      <section className="card"><details><summary>三角编号对应记忆（{Object.keys(memories).length} 条）</summary>
        <p>只保存逐条核对的对应关系，按厂家编号和描述区分；商品资料变化后需重新核对。与海大记忆独立。</p>
        {Object.entries(memories).map(([key, value]) => <p key={key}>{value.sourceCode} → {value.product.code} · {value.product.spec}
          <button className="link-button" onClick={() => { const next = { ...memories }; delete next[key]; saveMemories(next); invalidate(); }}>删除</button></p>)}
      </details></section>
    </main>
    <CatalogAdmin currentCatalog={catalog ?? undefined} onCatalogReady={next => { setCatalog(next); invalidate(); }} />
    <RecentHistory entries={history} onClear={() => setHistory([])} />
    <ProductPicker open={picker !== null} products={selectableProducts} sourceBrand="三角"
      sourceModel={results.find(result => result.row.rowNumber === picker)?.row.model}
      onClose={() => setPicker(null)} onSelect={product => { if (picker !== null) setReview({ rowNumber: picker, product }); setPicker(null); }} />
    {review && reviewRow && <div className="modal-backdrop"><div className="modal triangle-review" role="dialog" aria-modal="true" aria-label="逐条核对三角商品">
      <div className="modal-header"><h2>逐条核对商品</h2><button className="icon-button" aria-label="关闭核对" onClick={() => setReview(null)}>×</button></div>
      <p>厂家编号：<strong>{reviewRow.model}</strong></p><p>厂家描述：{reviewRow.description || '未提供'}</p>
      <p>目录编号：<strong>{review.product.code}</strong></p><p>目录规格：{review.product.spec}</p><p>单位：{review.product.unit}</p>
      <div className="alert warn">{triangleDescriptionDifferences(reviewRow.description, review.product.spec).join('；') || '请确认以上编号和商品确实对应。'}
        <p>只有核实为同一商品才能确认；PRO、PLUS 等不同版本不可互相替代。确认后保存本次编号和描述的对应记忆。</p></div>
      <div className="toolbar"><button className="primary" onClick={confirmProduct}>已核实，确认此商品</button><button className="secondary" onClick={() => setReview(null)}>返回</button></div>
    </div></div>}
    <ExportConfirmDialog open={format !== null} format={format} exportRows={ready.length} skippedRows={skipped.length + newRows.length}
      quantity={totalQty} amount={totalAmount} priceField={mapping?.price ?? ''} supplierName={TRIANGLE_SUPPLIER}
      newProductModels={newRows.map(({ row }) => `第 ${row.rowNumber} 行：${row.model} ${row.description}`)}
      skippedModels={skipped.map(({ row }) => `第 ${row.rowNumber} 行：${row.model}`)} onDownloadNewProducts={downloadNew}
      onConfirm={exportFile} onClose={() => setFormat(null)} />
  </div>;
}
