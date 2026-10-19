import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Product } from '../core/types';
import { normalizeText } from '../core/text';
import { aliasCode, aliasIsCurrent, readAliases } from '../core/aliases';
import type { AliasMap } from '../core/aliases';
import { AliasBackupWriter, forgetBackupFile, loadBackupFile, mergeBackupFile, saveBackupFile, serializeAliasBackup } from '../core/aliasBackup';
import type { BackupFile } from '../core/aliasBackup';

interface MappingManagerProps {
  aliases: AliasMap;
  products: Product[];
  adapterLabel: string;
  adapterId: string;
  backupRevision: number;
  onChange: (next: AliasMap) => void;
}

function downloadJson(fileName: string, payload: unknown): void {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function MappingManager({
  aliases,
  products,
  adapterLabel,
  adapterId,
  backupRevision,
  onChange,
}: MappingManagerProps) {
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'info' | 'error'>('info');
  const inputRef = useRef<HTMLInputElement>(null);
  const [backupMessage, setBackupMessage] = useState('未启用本地文件自动备份');
  const [backupName, setBackupName] = useState('');
  const [backupSession, setBackupSession] = useState(0);
  const [backupError, setBackupError] = useState(false);
  const latestAliases = useRef(aliases);
  latestAliases.current = aliases;
  const backupFile = useRef<BackupFile | null>(null);
  const backupWriter = useRef<AliasBackupWriter | null>(null);
  const backupGeneration = useRef(0);
  const picker = (window as Window & { showSaveFilePicker?: (options: unknown) => Promise<BackupFile> }).showSaveFilePicker;

  async function activateBackup(file: BackupFile, generation: number) {
    if (generation !== backupGeneration.current) return;
    backupFile.current = file;
    setBackupName(file.name);
    if (await file.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      setBackupError(true);
      setBackupMessage('需要重新授权文件写入，请点击“恢复自动备份”');
      return;
    }
    const existing = await (await file.getFile()).text();
    if (generation !== backupGeneration.current) return;
    mergeBackupFile(existing, latestAliases.current, adapterId, adapterLabel);
    await saveBackupFile(adapterId, file);
    if (generation !== backupGeneration.current) return;
    const merged = mergeBackupFile(existing, latestAliases.current, adapterId, adapterLabel);
    const writer = new AliasBackupWriter(file);
    backupWriter.current?.stop();
    backupWriter.current = writer;
    if (JSON.stringify(merged) !== JSON.stringify(latestAliases.current)) onChange(merged);
    await writer.write(serializeAliasBackup(merged, adapterId));
    if (generation !== backupGeneration.current) { writer.stop(); return; }
    setBackupError(false);
    setBackupMessage(`已自动备份 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    setBackupSession(value => value + 1);
  }

  useEffect(() => {
    const generation = ++backupGeneration.current;
    backupWriter.current?.stop();
    backupWriter.current = null;
    backupFile.current = null;
    setBackupName('');
    setBackupMessage('未启用本地文件自动备份');
    if (picker) loadBackupFile(adapterId).then(file => {
      if (file && generation === backupGeneration.current) return activateBackup(file, generation);
    }).catch(error => {
      if (generation === backupGeneration.current) {
        setBackupError(true);
        setBackupMessage(error instanceof Error ? error.message : '恢复备份文件失败，请重新选择');
      }
    });
    return () => { ++backupGeneration.current; backupWriter.current?.stop(); };
  }, [adapterId]);

  useEffect(() => {
    const writer = backupWriter.current;
    if (!writer) return;
    let current = true;
    setBackupMessage('正在更新本地备份…');
    writer.write(serializeAliasBackup(aliases, adapterId)).then(() => {
      if (!current) return;
      setBackupError(false);
      setBackupMessage(`已自动备份 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    }).catch(error => {
      if (!current) return;
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : '自动备份失败，请重试或手动导出');
    });
    return () => { current = false; };
  }, [aliases, adapterId, backupRevision, backupSession]);

  async function chooseBackupFile() {
    if (!picker) return;
    try {
      const file = await picker.call(window, { suggestedName: `型号映射记忆_${adapterId}.json`,
        types: [{ description: '型号映射 JSON 备份', accept: { 'application/json': ['.json'] } }] });
      const generation = ++backupGeneration.current;
      backupWriter.current?.stop();
      backupWriter.current = null;
      await activateBackup(file, generation);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : '选择备份文件失败');
    }
  }

  async function resumeBackup() {
    if (!backupFile.current) return;
    try {
      if (await backupFile.current.requestPermission({ mode: 'readwrite' }) !== 'granted') throw new Error('未获得文件写入权限，自动备份尚未恢复');
      const generation = ++backupGeneration.current;
      backupWriter.current?.stop();
      backupWriter.current = null;
      await activateBackup(backupFile.current, generation);
    } catch (error) {
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : '恢复自动备份失败');
    }
  }

  async function stopBackup() {
    ++backupGeneration.current;
    backupWriter.current?.stop();
    backupWriter.current = null;
    backupFile.current = null;
    try {
      await forgetBackupFile(adapterId);
      setBackupName('');
      setBackupError(false);
      setBackupMessage('自动备份已停用，已有 JSON 文件保留');
    } catch { setBackupError(true); setBackupMessage('停止写入成功，但未能忘记文件位置，请检查浏览器存储权限'); }
  }

  const productByCode = useMemo(
    () => new Map(products.map((product) => [product.code, product])),
    [products],
  );

  const entries = useMemo(
    () =>
      Object.entries(aliases)
        .map(([model, value]) => ({
          model,
          code: aliasCode(value),
          product: productByCode.get(aliasCode(value)),
          needsReview: typeof value === 'string' || !aliasIsCurrent(value, productByCode.get(aliasCode(value))),
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    [aliases, productByCode],
  );

  const filtered = useMemo(() => {
    const keyword = normalizeText(query);
    if (!keyword) return entries;
    return entries.filter((entry) =>
      normalizeText(`${entry.model} ${entry.code} ${entry.product?.spec ?? ''}`).includes(keyword),
    );
  }, [entries, query]);

  const stale = entries.filter((entry) => entry.needsReview);

  function notify(text: string, type: 'info' | 'error' = 'info') {
    setMessage(text);
    setMessageType(type);
  }

  function handleDelete(model: string) {
    const next = { ...aliases };
    delete next[model];
    onChange(next);
    notify('已删除这条映射');
  }

  function handleClear() {
    if (!window.confirm(`确定清空全部映射记忆吗？${backupWriter.current ? '已启用自动备份，绑定的 JSON 也会同步清空；需要保留旧记录请先手动导出一份。' : ''}`)) return;
    onChange({});
    notify('已清空全部映射');
  }

  function handleExport() {
    downloadJson(`映射记忆_${adapterLabel}_${new Date().toISOString().slice(0, 10)}.json`, {
      version: 2,
      type: 'tire-inbound-aliases',
      adapter: adapterLabel,
      exportedAt: new Date().toISOString(),
      aliases,
    });
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const source =
        parsed && typeof parsed === 'object' && 'aliases' in parsed
          ? (parsed as { aliases: unknown }).aliases
          : parsed;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error('JSON 格式不正确');
      }
      const valid = readAliases(source);
      const count = Object.keys(valid).length;
      if (!count) throw new Error('没有可导入的映射');
      onChange({ ...aliases, ...valid });
      notify(`已导入 ${count} 条映射，冲突项以导入文件为准`);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  return (
    <details className="card admin-card">
      <summary>
        <span>
          <strong>映射记忆管理</strong>
          <span className="summary-sub">人工确认过的厂家型号 → 商品编号 · {backupMessage}</span>
        </span>
        <span className="version-pill">{entries.length} 条</span>
      </summary>
      <div className="admin-body">
        <div className={`alert ${backupError ? 'warn' : 'info'}`}>
          <strong>本地 JSON 自动备份：{backupMessage}</strong>
          {backupName && <p>文件：{backupName}</p>}
          <p>选定文件后，新增或修改映射、完成匹配和导出时自动更新。文件位置由浏览器记住，重新打开后可能需要恢复授权。</p>
          {picker ? <button type="button" className="secondary" onClick={chooseBackupFile}>选择自动备份文件</button>
            : <p>当前浏览器不支持直接写入本地文件，请使用下方“导出映射 JSON”，或用支持该功能的 Chrome / Edge 打开。</p>}
          {backupName && <>
            <button type="button" className="secondary" onClick={resumeBackup}>恢复自动备份</button>
            <button type="button" className="link-button" onClick={stopBackup}>停用自动备份</button>
          </>}
        </div>
        <p className="muted">
          人工选择或确认后会保存型号字段和商品规格快照。相同型号换写法可复用；商品规格、品牌或单位变化后需要重新核对。记忆保存在本机，请定期导出备份。
          修改后请重新点击“开始匹配”才会生效。
        </p>

        <div className="admin-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={handleImport}
            hidden
          />
          <button type="button" className="secondary" onClick={() => inputRef.current?.click()}>
            导入映射 JSON
          </button>
          <button
            type="button"
            className="secondary"
            onClick={handleExport}
            disabled={entries.length === 0}
          >
            导出映射 JSON
          </button>
          <button
            type="button"
            className="link-button muted-link"
            onClick={handleClear}
            disabled={entries.length === 0}
          >
            清空全部
          </button>
        </div>

        {message && (
          <div className={`alert ${messageType === 'error' ? 'error' : 'success'}`}>{message}</div>
        )}

        {stale.length > 0 && (
          <div className="alert warn">
            有 {stale.length} 条映射缺少规格快照、商品已变更或编号不存在：
            {stale.slice(0, 5).map((entry) => entry.code).join('、')}
            {stale.length > 5 ? '…' : ''}
            。请删除或重新选择。
          </div>
        )}

        {entries.length > 0 && (
          <>
            <input
              className="search-input admin-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索厂家型号、商品编号或规格"
            />
            <div className="mapping-list">
              {filtered.map((entry) => (
                <div className="mapping-row" key={entry.model}>
                  <div className="mapping-key" title={entry.model}>{entry.model}</div>
                  <div className="mapping-code">{entry.code}</div>
                  <div className={`mapping-spec ${entry.product ? '' : 'warn-text'}`}>
                    {entry.product?.spec ?? '商品编号不存在'}{entry.needsReview ? '（需要重新核对）' : ''}
                  </div>
                  <button
                    type="button"
                    className="link-button muted-link"
                    onClick={() => handleDelete(entry.model)}
                  >
                    删除
                  </button>
                </div>
              ))}
              {filtered.length === 0 && <p className="empty">没有匹配的映射</p>}
            </div>
          </>
        )}

        {entries.length === 0 && <p className="empty">还没有保存的映射</p>}
      </div>
    </details>
  );
}
