import { useEffect } from 'react';
import type { TireDiff } from '../core/diff';

interface DiffDialogProps {
  open: boolean;
  rawModel: string;
  productCode?: string;
  productSpec?: string;
  diff?: TireDiff;
  confirmed: boolean;
  onConfirm: () => void;
  onReselect: () => void;
  onClose: () => void;
}

const KEY_FIELDS = new Set(['pattern', 'size', 'ply', 'loadSpeed']);

export function DiffDialog({
  open,
  rawModel,
  productCode,
  productSpec,
  diff,
  confirmed,
  onConfirm,
  onReselect,
  onClose,
}: DiffDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !diff) return null;

  const items = diff.items.filter((item) => KEY_FIELDS.has(item.field) || item.different);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal diff-modal"
        role="dialog"
        aria-modal="true"
        aria-label="型号差异对比"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>型号差异对比</h2>
            <p className="muted">核对厂家型号和商品资料是否确实是同一款</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="diff-body">
          <div className="diff-source">
            <div>
              <span>厂家型号</span>
              <strong>{rawModel}</strong>
            </div>
            <div>
              <span>商品规格</span>
              <strong>{productSpec ?? '未选择商品'}</strong>
              {productCode && <small>SKU：{productCode}</small>}
            </div>
          </div>

          {diff.hasCritical ? (
            <div className="alert error">
              关键字段不一致，不能批量确认。请逐条核对手动处理。
            </div>
          ) : diff.reasons.length > 0 ? (
            <div className="alert warn">
              差异：{diff.summary}。如果确认是同一款，可以点“确认使用此商品”。
            </div>
          ) : (
            <div className="alert success">关键字段一致。</div>
          )}

          <div className="diff-table">
            <div className="diff-table-head">
              <span>字段</span>
              <span>厂家型号</span>
              <span>商品资料</span>
            </div>
            {items.map((item) => (
              <div
                key={item.field}
                className={`diff-table-row ${
                  item.different ? (item.severity === 'critical' ? 'critical' : 'descriptor') : 'same'
                }`}
              >
                <span>{item.label}</span>
                <span>{item.manufacturer}</span>
                <span>{item.product}</span>
              </div>
            ))}
          </div>

          <div className="diff-actions">
            <button type="button" className="primary" onClick={onConfirm}>
              {confirmed ? '撤销确认并删除记忆' : '确认使用此商品'}
            </button>
            <button type="button" className="secondary" onClick={onReselect}>
              改选商品
            </button>
            <button type="button" className="link-button muted-link" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
