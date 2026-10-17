import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Product } from '../core/types';
import { normalizeText } from '../core/text';

interface MappingManagerProps {
  aliases: Record<string, string>;
  products: Product[];
  adapterLabel: string;
  onChange: (next: Record<string, string>) => void;
}

function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function MappingManager({
  aliases,
  products,
  adapterLabel,
  onChange,
}: MappingManagerProps) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error'>('info');
  const inputRef = useRef<HTMLInputElement>(null);

  const productByCode = useMemo(
    () => new Map(products.map((product) => [product.code, product])),
    [products],
  );

  const entries = useMemo(
    () =>
      Object.entries(aliases)
        .map(([model, code]) => ({
          model,
          code,
          product: productByCode.get(code),
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    [aliases, productByCode],
  );

  const filtered = useMemo(() => {
    const keyword = normalizeText(query);
    if (!keyword) return entries;
    return entries.filter((entry) =>
      normalizeText(`${entry.model} ${entry.code} ${entry.product?.spec ?? ''}`).includes(keyword),
    );
  }, [entries, query]);

  const stale = entries.filter((entry) => !entry.product);

  function notify(text: string, type: 'info' | 'error' = 'info') {
    setMessage(text);
    setMessageType(type);
  }

  function handleDelete(model: string) {
    const next = { ...aliases };
    delete next[model];
    onChange(next);
    notify('已删除这条映射');
  }

  function handleClear() {
    if (!window.confirm('确定清空全部映射记忆吗？')) return;
    onChange({});
    notify('已清空全部映射');
  }

  function handleExport() {
    downloadJson(`映射记忆_${adapterLabel}_${new Date().toISOString().slice(0, 10)}.json`, {
      version: 1,
      type: 'tire-inbound-aliases',
      adapter: adapterLabel,
      exportedAt: new Date().toISOString(),
      aliases,
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const source =
        parsed && typeof parsed === 'object' && 'aliases' in parsed
          ? (parsed as { aliases: unknown }).aliases
          : parsed;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('JSON 格式不正确');
      }
      const valid: Record<string, string> = {};
      Object.entries(source as Record<string, unknown>).forEach(([key, value]) => {
        if (typeof key === 'string' && typeof value === 'string' && key.trim() && value.trim()) {
          valid[normalizeText(key)] = value.trim();
        }
      });
      const count = Object.keys(valid).length;
      if (!count) throw new Error('没有可导入的映射');
      onChange({ ...aliases, ...valid });
      notify(`已导入 ${count} 条映射，冲突项以导入文件为准`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  return (
    <details className="card admin-card">
      <summary>
        <span>
          <strong>映射记忆管理</strong>
          <span className="summary-sub">人工确认过的厂家型号 → 商品编号</span>
        </span>
        <span className="version-pill">{entries.length} 条</span>
      </summary>
      <div className="admin-body">
        <p className="muted">
          人工选择商品后会保存在本机。下一次遇到相同厂家型号会优先命中这些映射。
          修改后请重新点击“开始匹配”才会生效。
        </p>

        <div className="admin-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            hidden
          />
          <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>
            导入映射 JSON
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleExport}
            disabled={entries.length === 0}
          >
            导出映射 JSON
          </button>
          <button
            type="button"
            className="link-button muted-link"
            onClick={handleClear}
            disabled={entries.length === 0}
          >
            清空全部
          </button>
        </div>

        {message && (
          <div className={`alert ${messageType === 'error' ? 'error' : 'success'}`}>{message}</div>
        )}

        {stale.length > 0 && (
          <div className="alert warn">
            有 {stale.length} 条映射指向的商品编号不在当前商品目录里：
            {stale.slice(0, 5).map((entry) => entry.code).join('、')}
            {stale.length > 5 ? '…' : ''}
            。请删除或重新选择。
          </div>
        )}

        {entries.length > 0 && (
          <>
            <input
              className="search-input admin-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索厂家型号、商品编号或规格"
            />
            <div className="mapping-list">
              {filtered.map((entry) => (
                <div className="mapping-row" key={entry.model}>
                  <div className="mapping-key" title={entry.model}>{entry.model}</div>
                  <div className="mapping-code">{entry.code}</div>
                  <div className={`mapping-spec ${entry.product ? '' : 'warn-text'}`}>
                    {entry.product?.spec ?? '商品编号不存在'}
                  </div>
                  <button
                    type="button"
                    className="link-button muted-link"
                    onClick={() => handleDelete(entry.model)}
                  >
                    删除
                  </button>
                </div>
              ))}
              {filtered.length === 0 && <p className="empty">没有匹配的映射</p>}
            </div>
          </>
        )}

        {entries.length === 0 && <p className="empty">还没有保存的映射</p>}
      </div>
    </details>
  );
}
