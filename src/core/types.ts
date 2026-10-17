export interface Product {
  code: string;
  name: string;
  spec: string;
  brand: string;
  unit: string;
  barcode?: string;
}

export interface Catalog {
  version: string;
  generatedAt: string;
  sourceFile?: string;
  products: Product[];
}

export interface ParsedTire {
  brand: string;
  pattern: string;
  size: string;
  ply?: string;
  loadSpeed?: string;
  flags: string[];
  raw: string;
}

export interface Candidate {
  product: Product;
  score: number;
  reason: string;
}

export type MatchStatus = 'matched' | 'review' | 'unmatched';
export type MatchMethod = 'alias' | 'exact' | 'core' | 'candidate' | 'manual' | 'none';

export interface MatchTrace {
  rowNumber: number;
  rawModel: string;
  parsed: ParsedTire | null;
  exactKey: string;
  coreKey: string;
  sizePatternKey: string;
  exactCount: number;
  coreCount: number;
  result: MatchStatus;
  method: MatchMethod;
  matchedCode?: string;
  warning?: string;
  reason?: string;
  candidates: Array<{
    code: string;
    spec: string;
    score: number;
    reason: string;
  }>;
  error?: string;
}

export interface MatchResult {
  status: MatchStatus;
  method: MatchMethod;
  product?: Product;
  candidates: Candidate[];
  warning?: string;
  reason?: string;
  parsed: ParsedTire | null;
  trace: MatchTrace;
}

export interface RawInboundRow {
  rowNumber: number;
  model: string;
  qty: number;
  price: number;
  unit: string;
  brand: string;
  source: Record<string, unknown>;
}

export interface InputMapping {
  model: string;
  qty: string;
  price: string;
  unit: string;
  brand: string;
}

export interface SectionTitle {
  rowNumber: number;
  text: string;
}

export interface ParsedWorkbook {
  fileName: string;
  sheetName: string;
  sheetNames: string[];
  headers: string[];
  headerRowIndex: number;
  sectionTitles: SectionTitle[];
  rows: Array<Record<string, unknown>>;
  mapping: InputMapping;
}

export interface ExportRow {
  supplier: string;
  code: string;
  name: string;
  spec: string;
  unit: string;
  qty: number;
  price: number;
}
