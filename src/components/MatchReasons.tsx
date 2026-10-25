import { EXPLANATION_LABELS } from '../core/explanations';
import type { MatchExplanation } from '../core/types';

export function MatchReasons({ items, compact = false }: { items?: MatchExplanation[]; compact?: boolean }) {
  if (!items?.length) return null;
  const codes = [...new Set(items.map(item => item.code))];
  if (compact) return <div className="reason-tags">{codes.map(code => <span key={code}>{EXPLANATION_LABELS[code]}</span>)}</div>;
  return <ul className="match-reasons">{codes.map(code => <li key={code}>
    <strong>{EXPLANATION_LABELS[code]}</strong>{items.filter(item => item.code === code).map((item, i) => <span key={i}>{item.message}</span>)}
  </li>)}</ul>;
}
