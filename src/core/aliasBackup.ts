import { readAliases } from './aliases';
import type { AliasMap } from './aliases';

export interface BackupFile {
  name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
}

export function serializeAliasBackup(aliases: AliasMap, adapter: string): string {
  return `${JSON.stringify({ version: 2, type: 'tire-inbound-aliases', adapter,
    exportedAt: new Date().toISOString(), aliases }, null, 2)}\n`;
}

export function mergeBackupFile(text: string, current: AliasMap, adapterId: string, adapterLabel: string): AliasMap {
  if (!text.trim()) return current;
  const payload = JSON.parse(text) as Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || payload.type !== 'tire-inbound-aliases' || ![adapterId, adapterLabel].includes(String(payload.adapter))) {
    throw new Error('所选文件不是当前供应商的映射备份，请选择新文件或正确的映射 JSON。');
  }
  if (!payload.aliases || typeof payload.aliases !== 'object' || Array.isArray(payload.aliases)) {
    throw new Error('备份记录格式不正确，未覆盖文件。');
  }
  const saved = readAliases(payload.aliases);
  if (payload.aliases && Object.keys(saved).length !== Object.keys(payload.aliases).length) {
    throw new Error('备份中有无法识别的记录，未覆盖文件，请先检查或导入核对。');
  }
  const conflicts = Object.keys(saved).filter(key => current[key] && JSON.stringify(saved[key]) !== JSON.stringify(current[key]));
  if (conflicts.length) throw new Error(`备份与浏览器中有 ${conflicts.length} 条同型号不同记忆，未覆盖文件。请先导入核对，或选择新备份文件。`);
  return { ...saved, ...current };
}

// Serialize writes so an earlier confirmation cannot overwrite a later one.
export class AliasBackupWriter {
  private queue: Promise<void> = Promise.resolve();
  private active = true;
  constructor(private file: BackupFile) {}
  stop() { this.active = false; }
  write(data: string): Promise<void> {
    const job = this.queue.catch(() => {}).then(async () => {
      if (!this.active) throw new Error('自动备份已停用');
      if (await this.file.queryPermission({ mode: 'readwrite' }) !== 'granted') {
        throw new Error('备份文件写入权限需要重新授权，请点击“恢复自动备份”。');
      }
      if (!this.active) throw new Error('自动备份已停用');
      const writable = await this.file.createWritable();
      try {
        if (!this.active) throw new Error('自动备份已停用');
        await writable.write(data);
        if (!this.active) throw new Error('自动备份已停用');
        await writable.close();
      }
      catch (error) { await writable.abort().catch(() => {}); throw error; }
    });
    this.queue = job;
    return job;
  }
}

function fileStore(adapterId: string, action: 'get' | 'put' | 'delete', handle?: BackupFile): Promise<BackupFile | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tire-inbound-backup-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('files', action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore('files');
      const operation = action === 'get' ? store.get(adapterId)
        : action === 'put' ? store.put(handle, adapterId) : store.delete(adapterId);
      transaction.oncomplete = () => { db.close(); resolve(action === 'get' ? operation.result : undefined); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
}

export const loadBackupFile = (adapterId: string) => fileStore(adapterId, 'get');
export const saveBackupFile = (adapterId: string, handle: BackupFile) => fileStore(adapterId, 'put', handle);
export const forgetBackupFile = (adapterId: string) => fileStore(adapterId, 'delete');
