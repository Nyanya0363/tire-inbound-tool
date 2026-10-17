import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../core/types';
import { normalizeText } from '../core/text';

interface ProductPickerProps {
  open: boolean;
  products: Product[];
  selectedCode?: string;
  onSelect: (product: Product) => void;
  onClose: () => void;
}

export function ProductPicker({
  open,
  products,
  selectedCode,
  onSelect,
  onClose,
}: ProductPickerProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const keyword = normalizeText(query);
    const sorted = [...products].sort((a, b) => a.code.localeCompare(b.code));
    if (!keyword) return sorted.slice(0, 80);
    return sorted
      .filter((product) => {
        const haystack = normalizeText(`${product.code} ${product.spec} ${product.name}`);
        return haystack.includes(keyword);
      })
      .slice(0, 100);
  }, [products, query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="选择商品"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>选择商品</h2>
            <p className="muted">按商品编号、规格或名称搜索</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <input
          autoFocus
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="例如：HD517-175R14LT 或 175R14LT"
        />
        <div className="picker-list">
          <div className="picker-list-head">
            <span>商品规格</span>
            <span>SKU</span>
            <span>单位</span>
          </div>
          {filtered.length === 0 ? (
            <p className="empty">没有找到商品</p>
          ) : (
            filtered.map((product) => (
              <button
                type="button"
                key={product.code}
                className={`picker-item ${selectedCode === product.code ? 'selected' : ''}`}
                onClick={() => onSelect(product)}
              >
                <span className="picker-spec-main">{product.spec}</span>
                <span className="picker-code-sub">{product.code}</span>
                <span className="picker-unit">{product.unit}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
