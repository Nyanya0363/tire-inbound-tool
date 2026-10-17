import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { buildCatalogFromFile, diffCatalogs } from '../core/catalogBuilder';
import type { Catalog } from '../core/types';

interface CatalogAdminProps {
  currentCatalog?: Catalog;
  onCatalogReady?: (catalog: Catalog) => void;
}

export function CatalogAdmin({ currentCatalog, onCatalogReady }: CatalogAdminProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ catalog: Catalog; duplicateCodes: string[] } | null>(null);
  const [baseline, setBaseline] = useState<Catalog | undefined>(currentCatalog);
  const [fileName, setFileName] = useState('');
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const [applied, setApplied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const diff = useMemo(
    () => (result ? diffCatalogs(baseline, result.catalog) : null),
    [result, baseline],
  );
  const hasRemovals = (diff?.removed.length ?? 0) > 0;
  const canDownload = !hasRemovals || confirmRemoval;

  async function handleFile(file: File) {
    setBusy(true);
    setError('');
    setResult(null);
    setConfirmRemoval(false);
    setApplied(false);
    setBaseline(currentCatalog);
    setFileName(file.name);
    try {
      const parsed = await buildCatalogFromFile(file);
      setResult(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }

  function downloadCatalog() {
    if (!result || !canDownload) return;
    const blob = new Blob([`${JSON.stringify(result.catalog, null, 2)}\n`], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'catalog.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function applyCatalog() {
    if (!result || !canDownload) return;
    onCatalogReady?.(result.catalog);
    setApplied(true);
  }

  return (
    <details className="card admin-card">
      <summary>
        <span>
          <strong>维护商品目录</strong>
          <span className="summary-sub">上传商品资料，生成 public/catalog.json</span>
        </span>
        {currentCatalog && <span className="version-pill">当前 {currentCatalog.version}</span>}
      </summary>
      <div className="admin-body">
        <p className="muted">
          只导出匹配需要的字段：商品编号、商品名称、规格/型号、品牌、单位、条码。不会导出成本价、库存、仓库位置。
        </p>
        <div className="admin-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleChange}
            hidden
          />
          <button
            type="button"
            className="secondary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? '解析中…' : '选择商品资料 Excel'}
          </button>
          {fileName && <span className="muted">{fileName}</span>}
        </div>

        {error && <div className="alert error">{error}</div>}

        {result && diff && (
          <div className="admin-result">
            <div className="admin-stats">
              <span><strong>{result.catalog.products.length}</strong> 个商品</span>
              <span>新目录版本 <strong>{result.catalog.version}</strong></span>
              <span>新增 <strong>{diff.added.length}</strong></span>
              <span className={diff.removed.length ? 'warn-text' : ''}>
                删除 <strong>{diff.removed.length}</strong>
              </span>
              <span className={diff.changed.length ? 'warn-text' : ''}>
                规格变化 <strong>{diff.changed.length}</strong>
              </span>
            </div>

            <div className="brand-chips">
              {diff.brandCounts.map((item) => (
                <span key={item.brand}>
                  {item.brand} <strong>{item.count}</strong>
                </span>
              ))}
            </div>

            {result.duplicateCodes.length > 0 && (
              <div className="alert warn">
                重复商品编号 {result.duplicateCodes.length} 个：
                {result.duplicateCodes.slice(0, 8).join('、')}
                {result.duplicateCodes.length > 8 ? '…' : ''}
              </div>
            )}

            {diff.removed.length > 0 && (
              <div className="alert error">
                这次更新会删除 {diff.removed.length} 个商品：
                {diff.removed.slice(0, 5).map((product) => product.code).join('、')}
                {diff.removed.length > 5 ? '…' : ''}
                。请确认这是预期的，删除后之前的映射可能失效。
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={confirmRemoval}
                    onChange={(event) => setConfirmRemoval(event.target.checked)}
                  />
                  我已确认要删除这些商品
                </label>
              </div>
            )}

            {diff.changed.length > 0 && (
              <div className="diff-list">
                <strong>规格有变化的商品（前 5 条）</strong>
                {diff.changed.slice(0, 5).map(({ before, after }) => (
                  <div key={after.code} className="diff-row">
                    <span>{after.code}</span>
                    <span>{before.spec}</span>
                    <span>→ {after.spec}</span>
                  </div>
                ))}
              </div>
            )}

            {diff.added.length > 0 && (
              <div className="diff-list">
                <strong>新增商品（前 5 条）</strong>
                {diff.added.slice(0, 5).map((product) => (
                  <div key={product.code} className="diff-row">
                    <span>{product.code}</span>
                    <span>{product.spec}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="admin-actions">
              <button
                type="button"
                className="primary"
                onClick={downloadCatalog}
                disabled={!canDownload}
              >
                下载 catalog.json
              </button>
              {onCatalogReady && (
                <button
                  type="button"
                  className="secondary"
                  onClick={applyCatalog}
                  disabled={!canDownload || applied}
                >
                  {applied ? '已在当前页面应用' : '在当前页面临时应用'}
                </button>
              )}
            </div>
            <p className="hint">
              下载后替换项目里的 <code>public/catalog.json</code>，提交到 GitHub。页面重新部署后，所有使用者会使用新目录。
              “临时应用”只影响当前页面，刷新后会恢复为已部署版本。
            </p>
          </div>
        )}
      </div>
    </details>
  );
}
