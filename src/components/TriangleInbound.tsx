import { useEffect, useMemo, useRef, useState } from 'react';
import { loadCatalog } from '../core/catalog';
import { createImportWorkbook, downloadWorkbook } from '../core/excel';
import { addHistory, loadHistory } from '../core/history';
import type { Catalog } from '../core/types';
import { CatalogAdmin } from './CatalogAdmin';
import { ExportConfirmDialog } from './ExportConfirmDialog';
import { RecentHistory } from './RecentHistory';
import {
  TRIANGLE_HEADERS, TRIANGLE_SUPPLIER, buildTriangleImport, matchTriangle,
  readTriangleWorkbook, triangleRows, triangleTable,
} from '../brands/triangle/inbound';
import type { TriangleDecision, TriangleMapping, TriangleResult, TriangleWorkbook } from '../brands/triangle/inbound';
import './TriangleInbound.css';

const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export function TriangleInbound({ onHaida }: { onHaida: () => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [book, setBook] = useState<TriangleWorkbook | null>(null);
  const [mapping, setMapping] = useState<TriangleMapping | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [date, setDate] = useState('');
  const [results, setResults] = useState<TriangleResult[]>([]);
  const [decisions, setDecisions] = useState<Record<number, TriangleDecision>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'xlsx' | 'xls' | null>(null);
  const [lastExport, setLastExport] = useState('');
  const [history, setHistory] = useState(loadHistory);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadSequence = useRef(0);
  useEffect(() => { loadCatalog().then(setCatalog).catch(err => setError(errorText(err))); }, []);

  function invalidate() {
    setResults([]); setDecisions({}); setFormat(null); setLastExport('');
  }
  const analysis = useMemo(() => {
    try { return { rows: book && mapping ? triangleRows(book, mapping) : [], error: '' }; }
    catch (err) { return { rows: [], error: errorText(err) }; }
  }, [book, mapping]);
  const dates = [...new Set(analysis.rows.map(row => row.date))].sort();
  const visible = analysis.rows.filter(row => !date || row.date === date);
  const selectedRows = analysis.rows.filter(row => selected.has(row.rowNumber));
  const included = results.filter(result => decisions[result.row.rowNumber]?.kind !== 'skip');
  const pending = included.filter(result => result.status === 'blocked');
  const ready = included.filter(result => result.status === 'matched');
  const totalQty = ready.reduce((sum, result) => sum + result.row.qty, 0);
  const totalAmount = ready.reduce((sum, result) => sum + result.row.qty * result.row.price, 0);
  const newRows = included.filter(result => result.status === 'new');
  const skipped = results.filter(result => decisions[result.row.rowNumber]?.kind === 'skip');

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
    setResults(selectedRows.map(row => matchTriangle(row, catalog)));
  }
  function setDecision(rowNumber: number, decision: TriangleDecision) {
    setDecisions(prev => ({ ...prev, [rowNumber]: decision })); setFormat(null); setLastExport('');
  }
  function clearDecision(result: TriangleResult) {
    const next = { ...decisions }; delete next[result.row.rowNumber]; setDecisions(next);
    setFormat(null); setLastExport('');
  }
  function downloadNew() {
    downloadWorkbook(triangleTable(['源行号', '供应商', '厂家产品编号', '产品描述', '发货日期', '数量', '单价', '说明'],
      newRows.map(({ row }) => [row.rowNumber, TRIANGLE_SUPPLIER, row.model, row.description, row.date, row.qty, row.price,
        '回业务系统建档，更新商品目录后重新匹配；本行未导入']), '待新建商品'), '三角_待新建商品.xlsx');
  }
  function downloadReport() {
    downloadWorkbook(triangleTable(['源行号', '产品编号', '产品描述', '发货日期', '数量', '单价', '处理结果', '对应商品编号', '目录规格', '说明', '目录版本'],
      results.map(result => {
        const disposition = decisions[result.row.rowNumber]?.kind;
        const excluded = disposition === 'skip' || result.status === 'new';
        return [result.row.rowNumber, result.row.model, result.row.description, result.row.date, result.row.qty, result.row.price,
          disposition === 'skip' ? '本次跳过' : result.status === 'new' ? '待新建' : result.status === 'matched' ? '可导入' : '数据异常',
          excluded ? '' : result.product?.code ?? '', excluded ? '' : result.product?.spec ?? '',
          disposition === 'skip' ? '本次跳过，不写入入库模板' : result.reason, catalog?.version ?? ''];
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
        <div className="section-heading"><span className="step">01</span><div><h2>上传三角已发货订单</h2></div></div>
        <div className="upload-guide"><p>只按完整 SKU（产品编号）匹配：命中即可导入，未命中自动列为待新建。产品描述仅展示，不参与匹配。数量和价格直接用于入库，配套商品单价为 0 也可正常导入。</p>
        <p className="muted">只读取第一个工作表。发货日期不代表实际入库日期；数量为本次整行入库数量，部分到货请先调整原表。切换供应商会清空当前处理结果。</p>
        <div className="header-chips">{TRIANGLE_HEADERS.map(header => <span key={header}>{header}</span>)}</div>
        <div className="upload-guide-actions"><button className="link-button" onClick={() => downloadWorkbook(triangleTable(TRIANGLE_HEADERS, [], 'Sheet1'), '三角_空白表头.xlsx')}>下载空白表头</button>
          <button className="link-button" onClick={() => downloadWorkbook(triangleTable(TRIANGLE_HEADERS,
            [['CBCTR92819F15DH0', '195/70R15C(TR928)104/102S 三角', 2, 218, '2026-10-18', '', '']], 'Sheet1'), '三角_示例_勿直接导入.xlsx')}>下载示例文件</button></div></div>
        <label className={`dropzone ${busy ? 'disabled' : ''}`} role="button" tabIndex={0}
          onKeyDown={event => { if (!busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInput.current?.click(); } }} onDragOver={event => event.preventDefault()} onDrop={event => {
          event.preventDefault(); if (!busy && event.dataTransfer.files[0]) void upload(event.dataTransfer.files[0]);
        }}><strong>{busy ? '正在读取…' : '选择三角 Excel，或拖入文件'}</strong>
          <span>支持 .xlsx / .xls / .csv；程序只读取第一个工作表</span><input hidden ref={fileInput} aria-label="上传三角订单" type="file" accept=".xlsx,.xls,.csv" disabled={busy}
            onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
        {error && <p className="alert error" role="alert">{error}</p>}
        {!catalog && <p className="muted">商品目录尚未加载，加载完成后才能匹配。</p>}
      </section>
      {book && mapping && <section className="card">
        <div className="section-heading"><span className="step">02</span><div><h2>核对字段与本次入库范围</h2></div></div>
        <p>{book.fileName} · 工作表 {book.sheetName} · {book.rows.length} 行{book.sheetCount > 1 ? `（共 ${book.sheetCount} 个工作表，仅读取第一个）` : ''}</p>
        <div className="mapping-grid">{(Object.keys(mapping) as Array<keyof TriangleMapping>).map(key => <label className="field" key={key}>
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
        <div className="section-heading"><span className="step">03</span><div><h2>核对结果并导出</h2></div></div>
        <div className="summary-grid">{[["可导入", ready.length], ["数据异常", pending.length], ["待新建", newRows.length], ["本次跳过", skipped.length]].map(([label, count]) => <div className="stat" key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
        <p>导出数量 {totalQty} · 导出金额 ¥{money(totalAmount)} · 与所选源行差额 ¥{money(validSourceAmount - totalAmount)}</p>
        <p className="muted">同编号的多行订单分别保留。SKU 未命中的新品自动排除在入库模板之外，可下载待新建清单；数据异常行须修正或明确跳过。</p>
        <div className="toolbar">{(['xlsx', 'xls'] as const).map(value => <button key={value} className="primary" disabled={pending.length > 0 || !ready.length} onClick={() => setFormat(value)}>下载导入模板 .{value}</button>)}
          <button className="secondary" onClick={downloadReport}>下载匹配报告</button>
          {!!newRows.length && <button className="secondary" onClick={downloadNew}>下载待新建清单</button>}
          <button className="secondary" onClick={reset}>重新开始</button></div>
        {lastExport && <p className="alert success">{lastExport}</p>}
        <div className="table-wrap"><table><thead><tr><th>源行</th><th>厂家编号 / 描述</th><th>数量 / 单价</th><th>状态与原因</th><th>目录商品</th><th>操作</th></tr></thead>
          <tbody>{results.map(result => {
            const decision = decisions[result.row.rowNumber];
            const label = decision?.kind === 'skip' ? '本次跳过' : result.status === 'new' ? '待新建' : result.status === 'matched' ? '可导入' : '数据异常';
            const product = result.product;
            return <tr key={result.row.rowNumber}><td>{result.row.rowNumber}</td><td><strong>{result.row.model}</strong><div>{result.row.description}</div></td>
              <td>{Number.isFinite(result.row.qty) ? result.row.qty : '无效'} / {Number.isFinite(result.row.price) ? result.row.price : '无效'}</td>
              <td><span className={`badge ${label === '可导入' ? 'matched' : 'review'}`}>{label}</span><div>{result.reason}</div></td>
              <td>{product ? <><strong>{product.code}</strong><div>{product.spec}</div><small>单位：{product.unit}</small></> : '—'}</td>
              <td><div className="row-actions">
                {decision ? <button className="row-action" onClick={() => clearDecision(result)}>取消跳过</button>
                  : <button className="row-action" onClick={() => setDecision(result.row.rowNumber, { kind: 'skip' })}>本次跳过</button>}
              </div></td></tr>;
          })}</tbody></table></div>
      </section>}
    </main>
    <CatalogAdmin currentCatalog={catalog ?? undefined} onCatalogReady={next => { setCatalog(next); invalidate(); }} />
    <RecentHistory entries={history} onClear={() => setHistory([])} />
    <ExportConfirmDialog open={format !== null} format={format} exportRows={ready.length} skippedRows={skipped.length + newRows.length}
      quantity={totalQty} amount={totalAmount} priceField={mapping?.price ?? ''} supplierName={TRIANGLE_SUPPLIER}
      newProductModels={newRows.map(({ row }) => `第 ${row.rowNumber} 行：${row.model} ${row.description}`)}
      skippedModels={skipped.map(({ row }) => `第 ${row.rowNumber} 行：${row.model}`)} onDownloadNewProducts={downloadNew}
      onConfirm={exportFile} onClose={() => setFormat(null)} />
  </div>;
}
