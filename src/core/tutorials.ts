export type TutorialType = 'video' | 'link';

export interface Tutorial {
  id: string;
  title: string;
  description?: string;
  url: string;
  type: TutorialType;
}

export interface TutorialCatalog {
  version: number;
  updatedAt?: string;
  tutorials: Tutorial[];
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url);
}

export async function loadTutorials(): Promise<TutorialCatalog> {
  const response = await fetch(`${import.meta.env.BASE_URL}tutorials.json`, {
    cache: 'no-cache',
  });
  if (!response.ok) {
    return { version: 1, tutorials: [] };
  }
  const data = (await response.json()) as TutorialCatalog;
  return {
    version: data.version ?? 1,
    updatedAt: data.updatedAt,
    tutorials: Array.isArray(data.tutorials) ? data.tutorials : [],
  };
}

export function createTutorialsCatalog(tutorials: Tutorial[]): TutorialCatalog {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tutorials,
  };
}

export function downloadTutorials(tutorials: Tutorial[]): void {
  const blob = new Blob([`${JSON.stringify(createTutorialsCatalog(tutorials), null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tutorials.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
