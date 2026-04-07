import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generic JSON file store with atomic writes.
 * Reads/writes JSON files, supports both single-object and array-based stores.
 */
export class FileStore<T extends { id: string }> {
  constructor(private dirOrFile: string, private mode: 'directory' | 'single-file') {}

  /** For single-file mode: read the entire array */
  async readAll(): Promise<T[]> {
    if (this.mode === 'single-file') {
      try {
        const raw = await fs.readFile(this.dirOrFile, 'utf-8');
        return JSON.parse(raw) as T[];
      } catch {
        return [];
      }
    }
    // directory mode: read all .json files
    try {
      const files = await fs.readdir(this.dirOrFile);
      const items: T[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const raw = await fs.readFile(path.join(this.dirOrFile, file), 'utf-8');
        items.push(JSON.parse(raw) as T);
      }
      return items;
    } catch {
      return [];
    }
  }

  /** Read a single item by ID */
  async read(id: string): Promise<T | null> {
    if (this.mode === 'single-file') {
      const all = await this.readAll();
      return all.find((item) => item.id === id) ?? null;
    }
    try {
      const raw = await fs.readFile(path.join(this.dirOrFile, `${id}.json`), 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Write a single item (create or update) */
  async write(item: T): Promise<void> {
    if (this.mode === 'single-file') {
      const all = await this.readAll();
      const idx = all.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        all[idx] = item;
      } else {
        all.push(item);
      }
      await this.atomicWrite(this.dirOrFile, JSON.stringify(all, null, 2));
      return;
    }
    const filePath = path.join(this.dirOrFile, `${item.id}.json`);
    await this.atomicWrite(filePath, JSON.stringify(item, null, 2));
  }

  /** Delete a single item by ID */
  async delete(id: string): Promise<boolean> {
    if (this.mode === 'single-file') {
      const all = await this.readAll();
      const filtered = all.filter((i) => i.id !== id);
      if (filtered.length === all.length) return false;
      await this.atomicWrite(this.dirOrFile, JSON.stringify(filtered, null, 2));
      return true;
    }
    try {
      await fs.unlink(path.join(this.dirOrFile, `${id}.json`));
      return true;
    } catch {
      return false;
    }
  }

  private async atomicWrite(filePath: string, data: string): Promise<void> {
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, data, 'utf-8');
    await fs.rename(tmpPath, filePath);
  }
}
