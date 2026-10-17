import { useEffect } from 'react';

interface ExportConfirmDialogProps {
  open: boolean;
  format: 'xlsx' | 'xls' | null;
  exportRows: number;
  skippedRows: number;
  quantity: number;
  amount: number;
  priceField: string;
  supplierName: string;
  onConfirm: () => void;
  onClose: () => void;
}

function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

export function ExportConfirmDialog({
  open,
  format,
  exportRows,
  skippedRows,
  quantity,
  amount,
  priceField,
  supplierName,
  onConfirm,
  onClose,
}: ExportConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open || !format) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        className="modal export-modal"
        role="dialog"
        aria-modal="true"
        aria-label="确认导出"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>确认导出</h2>
            <p className="muted">请最后核对导出范围和合计</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="export-body">
          <div className="export-grid">
            <div>
              <span>将导出</span>
              <strong>{exportRows} 行</strong>
            </div>
            <div>
              <span>跳过</span>
              <strong>{skippedRows} 行</strong>
            </div>
            <div>
              <span>数量合计</span>
              <strong>{formatNumber(quantity, 0)} 条</strong>
            </div>
            <div>
              <span>金额合计</span>
              <strong>¥{formatNumber(amount)}</strong>
            </div>
          </div>
          <dl className="export-meta">
            <div><dt>文件格式</dt><dd>{format === 'xlsx' ? 'Excel .xlsx' : 'Excel .xls'}</dd></div>
            <div><dt>供应商</dt><dd>{supplierName || '未填写'}</dd></div>
            <div><dt>单价口径</dt><dd>{priceField || '未选择单价列'}</dd></div>
          </dl>
          {skippedRows > 0 && (
            <div className="alert warn">
              有 {skippedRows} 行不会写入导入模板。请确认这是预期结果。
            </div>
          )}
          <div className="export-actions">
            <button type="button" className="primary" onClick={onConfirm}>
              确认下载
            </button>
            <button type="button" className="secondary" onClick={onClose}>
              返回检查
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
