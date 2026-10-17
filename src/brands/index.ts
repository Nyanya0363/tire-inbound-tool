import type { BrandAdapter } from './types';
import { haidaAdapter } from './haida/adapter';

export const brandAdapters: BrandAdapter[] = [haidaAdapter];

export function getBrandAdapter(id: string): BrandAdapter | undefined {
  return brandAdapters.find((adapter) => adapter.id === id);
}
