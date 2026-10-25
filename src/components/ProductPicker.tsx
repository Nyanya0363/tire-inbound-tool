import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../core/types';
import { normalizeBrand, normalizeText } from '../core/text';

interface ProductPickerProps {
  open: boolean;
  products: Product[];
  selectedCode?: string;
  sourceModel?: string;
  sourceBrand?: string;
  onSelect: (product: Product) => void;
  onClose: () => void;
}

export function filterPickerProducts(products: Product[], query: string): Product[] {
  const keywords = normalizeText(query).split(/\s+/).filter(Boolean).map(normalizeBrand);
  return [...products].sort((a, b) => a.code.localeCompare(b.code))
    .filter(product => {
      const text = normalizeText(`${product.code} ${product.spec} ${product.name} ${product.brand} ${normalizeBrand(product.brand)}`);
      return keywords.every(keyword => text.includes(keyword));
    }).slice(0, keywords.length ? 100 : 80);
}

export function ProductPicker({
  open,
  products,
  selectedCode,
  sourceModel,
  sourceBrand,
  onSelect,
  onClose,
}: ProductPickerProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const filtered = useMemo(() => filterPickerProducts(products, query), [products, query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal product-picker"
        role="dialog"
        aria-modal="true"
        aria-label="选择商品"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>选择商品</h2>
            <p className="muted">按品牌、商品编号、规格或名称搜索</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="picker-search">
          {sourceModel && <div className="picker-source">
            <strong>厂家品牌：{sourceBrand || '待识别'}</strong>
            <span>厂家型号：{sourceModel}</span>
          </div>}
          <input
            autoFocus
            type="search"
            aria-label="搜索商品品牌、规格、SKU 或名称"
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="例如：迈劲 185R14C，或 HD517-175R14LT"
          />
          <small className="picker-search-note">已显示 {filtered.length} 条，最多显示 {query.trim() ? '100' : '80'} 条；可同时输入品牌和规格缩小范围。</small>
        </div>
        <div className="picker-list" role="region" aria-label="可选商品" tabIndex={0}>
          <div className="picker-list-head">
            <span>品牌</span>
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
                aria-pressed={selectedCode === product.code}
                onClick={() => onSelect(product)}
              >
                <span className="picker-brand">{product.brand || '未标注品牌'}</span>
                <span className="picker-spec-main">{product.spec}</span>
                <span className="picker-code-sub">SKU：{product.code}</span>
                <span className="picker-unit">{product.unit}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
