import { describe, expect, it } from 'vitest';
import { AliasBackupWriter, mergeBackupFile, serializeAliasBackup } from '../src/core/aliasBackup';
import type { BackupFile } from '../src/core/aliasBackup';

function fakeFile() {
  const state = { content: 'old', permission: 'granted' as PermissionState, writes: [] as string[], fail: false, aborted: false };
  const file: BackupFile = {
    name: 'mapping.json', getFile: async () => ({ text: async () => state.content }),
    queryPermission: async () => state.permission, requestPermission: async () => state.permission,
    createWritable: async () => {
      let next = '';
      return {
        write: async value => { if (state.fail) throw new Error('disk failure'); next = value; state.writes.push(value); },
        close: async () => { state.content = next; },
        abort: async () => { state.aborted = true; },
      };
    },
  };
  return { file, state };
}

describe('local mapping JSON backups', () => {
  it('serializes concurrent updates in order and leaves the latest version on disk', async () => {
    const { file, state } = fakeFile();
    const writer = new AliasBackupWriter(file);
    await Promise.all([writer.write('first'), writer.write('second'), writer.write('latest')]);
    expect(state.writes).toEqual(['first', 'second', 'latest']);
    expect(state.content).toBe('latest');
  });

  it('reports revoked permission without touching the existing file', async () => {
    const { file, state } = fakeFile();
    state.permission = 'prompt';
    await expect(new AliasBackupWriter(file).write('new')).rejects.toThrow('重新授权');
    expect(state.content).toBe('old');
    expect(state.writes).toEqual([]);
  });

  it('aborts failed writes and allows a later retry', async () => {
    const { file, state } = fakeFile();
    const writer = new AliasBackupWriter(file);
    state.fail = true;
    await expect(writer.write('bad')).rejects.toThrow('disk failure');
    expect(state.content).toBe('old');
    expect(state.aborted).toBe(true);
    state.fail = false;
    await writer.write('recovered');
    expect(state.content).toBe('recovered');
  });

  it('does not commit queued writes after stopping', async () => {
    const { file, state } = fakeFile();
    const writer = new AliasBackupWriter(file);
    const pending = writer.write('new');
    writer.stop();
    await expect(pending).rejects.toThrow('停用');
    expect(state.content).toBe('old');
  });

  it('merges an existing backup before writing, preserving prior records', () => {
    const text = serializeAliasBackup({ OLD: 'SKU1' }, 'haida');
    expect(mergeBackupFile(text, { NEW: 'SKU2' }, 'haida', '海大')).toEqual({ OLD: 'SKU1', NEW: 'SKU2' });
    expect(mergeBackupFile('', { NEW: 'SKU2' }, 'haida', '海大')).toEqual({ NEW: 'SKU2' });
  });

  it('rejects conflicts, unrelated files and malformed records without replacing them', () => {
    expect(() => mergeBackupFile(serializeAliasBackup({ A: 'old' }, 'haida'), { A: 'new' }, 'haida', '海大')).toThrow('未覆盖');
    expect(() => mergeBackupFile(serializeAliasBackup({}, 'other'), {}, 'haida', '海大')).toThrow('当前供应商');
    expect(() => mergeBackupFile('null', {}, 'haida', '海大')).toThrow('当前供应商');
    expect(() => mergeBackupFile(JSON.stringify({ type: 'tire-inbound-aliases', adapter: 'haida', aliases: { A: {} } }), {}, 'haida', '海大')).toThrow('未覆盖');
    expect(() => mergeBackupFile(JSON.stringify({ type: 'tire-inbound-aliases', adapter: 'haida', aliases: [] }), {}, 'haida', '海大')).toThrow('未覆盖');
  });
});
