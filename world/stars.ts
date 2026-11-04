import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface LetterStar { letterId: string; starredAt: number; memorySelected: boolean }

/** Local collection/consent only. Bodies remain in the letterbook, never in this file. */
export class LetterStars {
  private records = new Map<string, LetterStar>();
  private dirty = false;
  private loaded = false;
  private revokeOnLoad = false;
  readonly file: string;
  constructor(dir: string) { this.file = join(dir, 'bottle-stars.json'); }
  load(): void {
    // Do not overwrite an unsaved denial with stale authorization from disk.
    if (this.dirty && this.loaded) {
      try { this.save(); } catch { return; }
    }
    this.records.clear();
    this.dirty = false;
    this.loaded = false;
    try {
      const data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { stars: [] };
      for (const item of Array.isArray(data.stars) ? data.stars : []) {
        if (!item || typeof item.letterId !== 'string' || !item.letterId || item.letterId.length > 256 ||
            !Number.isFinite(item.starredAt) || item.starredAt < 0 || this.records.has(item.letterId)) continue;
        this.records.set(item.letterId, { letterId: item.letterId, starredAt: item.starredAt, memorySelected: item.memorySelected === true });
      }
      this.loaded = true;
      if (this.revokeOnLoad) {
        for (const row of this.records.values()) row.memorySelected = false;
        this.save();
      }
    } catch { /* Corrupt or unreadable authorization fails closed. */ }
  }
  all(): LetterStar[] { return [...this.records.values()].map(item => ({ ...item })).sort((a,b) => b.starredAt-a.starredAt || a.letterId.localeCompare(b.letterId)); }
  get(id: string): LetterStar | undefined { const row = this.records.get(id); return row ? { ...row } : undefined; }
  needsSave(): boolean { return this.dirty || this.revokeOnLoad; }
  set(id: string, enabled: boolean, now: number): void {
    if (enabled && !this.records.has(id)) this.records.set(id, { letterId: id, starredAt: now, memorySelected: false });
    if (!enabled) this.records.delete(id);
    this.save();
  }
  select(id: string, enabled: boolean): void {
    const row = this.records.get(id);
    if (!row) throw Error('not_starred');
    row.memorySelected = enabled;
    try { this.save(); }
    catch (error) { row.memorySelected = false; throw error; }
  }
  revokeAll(loadBeforeRevoking = false): void {
    if (!this.loaded) {
      if (!loadBeforeRevoking && !this.revokeOnLoad) return;
      this.revokeOnLoad = true;
      this.load();
      if (!this.loaded) throw Error('consent_store_unreadable');
    }
    let changed = false;
    for (const item of this.records.values()) if (item.memorySelected) { item.memorySelected = false; changed = true; }
    if (changed || this.needsSave()) this.save();
  }
  private save(): void {
    this.dirty = true;
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      writeFileSync(temp, JSON.stringify({ schemaVersion: 1, stars: this.all() }) + '\n', { encoding: 'utf8', mode: 0o600 });
      renameSync(temp, this.file);
      this.dirty = false;
      this.revokeOnLoad = false;
      this.loaded = true;
    } finally { try { unlinkSync(temp); } catch { /* Nothing left to clean. */ } }
  }
}
