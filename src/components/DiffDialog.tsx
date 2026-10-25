import { useEffect } from 'react';
import type { TireDiff } from '../core/diff';
import { formatFlags } from '../core/diff';
import type { MatchExplanation, ParsedTire } from '../core/types';
import { MatchReasons } from './MatchReasons';

interface DiffDialogProps {
  open: boolean;
  rawModel: string;
  productCode?: string;
  productSpec?: string;
  diff?: TireDiff;
  explanations?: MatchExplanation[];
  manufacturer?: ParsedTire;
  product?: ParsedTire;
  candidate?: boolean;
  confirmed: boolean;
  onConfirm: () => void;
  onReselect: () => void;
  onClose: () => void;
}

const KEY_FIELDS = new Set(['brand', 'pattern', 'size', 'ply', 'loadSpeed']);

export function DiffDialog({
  open,
  rawModel,
  productCode,
  productSpec,
  diff,
  explanations,
  manufacturer,
  product,
  candidate = false,
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

  if (!open) return null;

  const items = diff?.items.filter(item => KEY_FIELDS.has(item.field)) ?? [];
  if (manufacturer && product) items.push({ field: 'flags', label: '附加标识',
    manufacturer: formatFlags(manufacturer.flags), product: formatFlags(product.flags),
    different: [...manufacturer.flags].sort().join() !== [...product.flags].sort().join(),
    severity: diff?.items.some(item => item.field.startsWith('flag:') && item.different && item.severity === 'critical') ? 'critical' : 'descriptor',
  });

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

        <div className="diff-body" role="region" aria-label="型号对比明细" tabIndex={0}>
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

          {candidate && <p className="match-next-step">正在查看候选商品；查看和关闭不会确认商品，也不会保存映射。</p>}
          <MatchReasons items={explanations} />
          {!explanations?.length && diff && (diff.hasCritical ? (
            <div className="alert error">
              关键字段不一致，不能批量确认。请逐条核对手动处理。
            </div>
          ) : diff && diff.reasons.length > 0 ? (
            <div className="alert warn">
              差异：{diff.summary}。如果确认是同一款，可以点“确认使用此商品”。
            </div>
          ) : (
            <div className="alert success">关键字段一致。</div>
          ))}

          {!diff && <p className="alert warn">型号无法完整解析，请结合双方原文人工核对。未识别不代表没有该商品。</p>}

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
                <span data-label="厂家型号">{item.manufacturer === '无' ? manufacturer?.unrecognized ? '未完整识别，请结合原文' : '未提供' : item.manufacturer}</span>
                <span data-label="商品资料">{item.product === '无' ? product?.unrecognized ? '未完整识别，请结合原文' : '未提供' : item.product}</span>
              </div>
            ))}
          </div>

        </div>
        <div className="diff-actions">
            <button type="button" className="primary" onClick={onConfirm}>
              {candidate ? '选择此商品' : confirmed ? '撤销确认并删除记忆' : '确认使用此商品'}
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
  );
}
