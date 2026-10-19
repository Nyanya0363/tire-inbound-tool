import type { ParsedTire, Product } from '../core/types';

export interface BrandAdapter {
  id: string;
  label: string;
  supplierName: string;
  version: string;
  brandAliases: string[];
  confirmedMappings?: Array<{ model: string; code: string; spec: string; brand: string; unit: string }>;

  inputAliases: {
    model: string[];
    qty: string[];
    price: string[];
    unit: string[];
    brand: string[];
  };

  parseInbound(raw: string, brand?: string): ParsedTire;
  parseProduct(product: Product): ParsedTire | null;
}
