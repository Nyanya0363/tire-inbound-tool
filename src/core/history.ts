export interface HistoryEntry {
  id: string;
  time: string;
  fileName: string;
  brand: string;
  total: number;
  imported: number;
  review: number;
  unmatched: number;
  quantity: number;
  amount: number;
  format: 'xlsx' | 'xls';
  priceField: string;
  catalogVersion: string;
  appVersion: string;
  commitSha: string;
}

const STORAGE_KEY = 'tire-inbound:history';
const MAX_ENTRIES = 20;

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'time'>): HistoryEntry[] {
  const next: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
  };
  const entries = [next, ...loadHistory()].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  return entries;
}

export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}
