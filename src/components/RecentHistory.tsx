import type { HistoryEntry } from '../core/history';
import { clearHistory } from '../core/history';

interface RecentHistoryProps {
  entries: HistoryEntry[];
  onClear: () => void;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function RecentHistory({ entries, onClear }: RecentHistoryProps) {
  function handleClear() {
    if (!window.confirm('确定清空最近处理记录吗？')) return;
    clearHistory();
    onClear();
  }

  return (
    <details className="card admin-card">
      <summary>
        <span>
          <strong>最近处理记录</strong>
          <span className="summary-sub">只保存在本机，用于确认有没有重复处理</span>
        </span>
        <span className="version-pill">{entries.length} 条</span>
      </summary>
      <div className="admin-body">
        {entries.length === 0 ? (
          <p className="empty">还没有导出记录</p>
        ) : (
          <>
            <div className="history-list">
              {entries.map((entry) => (
                <div className="history-row" key={entry.id}>
                  <div>
                    <strong>{entry.fileName}</strong>
                    <span>{formatTime(entry.time)} · {entry.brand} · {entry.format.toUpperCase()}</span>
                  </div>
                  <div className="history-counts">
                    <span className="ok-text">可导入 {entry.imported}</span>
                    <span className="warn-text">需确认 {entry.review}</span>
                    <span className="bad-text">不可导入 {entry.unmatched}</span>
                    <span>{entry.quantity} 条</span>
                    <span>¥{entry.amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="link-button muted-link" onClick={handleClear}>
              清空记录
            </button>
          </>
        )}
      </div>
    </details>
  );
}
