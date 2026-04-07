import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FileStore } from './file-store.js';

interface TestItem {
  id: string;
  name: string;
  value: number;
}

describe('FileStore (directory mode)', () => {
  let dir: string;
  let store: FileStore<TestItem>;

  beforeEach(async () => {
    dir = path.join(os.tmpdir(), `filestore-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    store = new FileStore<TestItem>(dir, 'directory');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('readAll returns empty array when no files', async () => {
    const items = await store.readAll();
    expect(items).toEqual([]);
  });

  it('write and read single item', async () => {
    await store.write({ id: 'a', name: 'Alice', value: 1 });
    const item = await store.read('a');
    expect(item).toEqual({ id: 'a', name: 'Alice', value: 1 });
  });

  it('write and readAll', async () => {
    await store.write({ id: 'a', name: 'Alice', value: 1 });
    await store.write({ id: 'b', name: 'Bob', value: 2 });
    const items = await store.readAll();
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('update existing item', async () => {
    await store.write({ id: 'a', name: 'Alice', value: 1 });
    await store.write({ id: 'a', name: 'Alice Updated', value: 99 });
    const item = await store.read('a');
    expect(item?.name).toBe('Alice Updated');
    expect(item?.value).toBe(99);
  });

  it('delete item', async () => {
    await store.write({ id: 'a', name: 'Alice', value: 1 });
    const deleted = await store.delete('a');
    expect(deleted).toBe(true);
    const item = await store.read('a');
    expect(item).toBeNull();
  });

  it('delete non-existent returns false', async () => {
    const deleted = await store.delete('nonexistent');
    expect(deleted).toBe(false);
  });

  it('read non-existent returns null', async () => {
    const item = await store.read('nonexistent');
    expect(item).toBeNull();
  });
});

describe('FileStore (single-file mode)', () => {
  let filePath: string;
  let store: FileStore<TestItem>;

  beforeEach(async () => {
    const dir = path.join(os.tmpdir(), `filestore-sf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    filePath = path.join(dir, 'items.json');
    store = new FileStore<TestItem>(filePath, 'single-file');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(filePath), { recursive: true, force: true });
  });

  it('readAll returns empty when file missing', async () => {
    const items = await store.readAll();
    expect(items).toEqual([]);
  });

  it('write and read', async () => {
    await store.write({ id: 'x', name: 'X', value: 10 });
    const item = await store.read('x');
    expect(item).toEqual({ id: 'x', name: 'X', value: 10 });
  });

  it('multiple writes accumulate', async () => {
    await store.write({ id: 'a', name: 'A', value: 1 });
    await store.write({ id: 'b', name: 'B', value: 2 });
    const all = await store.readAll();
    expect(all).toHaveLength(2);
  });

  it('update in single-file mode', async () => {
    await store.write({ id: 'a', name: 'A', value: 1 });
    await store.write({ id: 'a', name: 'A2', value: 99 });
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('A2');
  });

  it('delete from single-file', async () => {
    await store.write({ id: 'a', name: 'A', value: 1 });
    await store.write({ id: 'b', name: 'B', value: 2 });
    const deleted = await store.delete('a');
    expect(deleted).toBe(true);
    const all = await store.readAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('b');
  });
});
