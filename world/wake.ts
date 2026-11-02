/** Random invitations are World tasks, never promises to send a letter. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type WakeAction = 'write' | 'catch' | 'remind';
const ACTIONS: WakeAction[] = ['write', 'catch', 'remind'];
export type WakeReason = 'no_idea' | 'not_now' | 'user_declined' | 'user_paused';
export type WakeResult = 'completed' | 'deferred' | 'declined' | 'paused' | 'uncompleted' | 'failed' | 'cancelled' | 'interrupted';
export interface WakeTask {
  id: string; action: WakeAction; phase: 'queued' | 'rendered' | 'delivered' | 'retry';
  attempts: number; createdAt: number; dueAt: number; manual?: boolean; remote?: boolean;
}
export interface WakeOutcome { id: string; action: WakeAction; result: WakeResult; reason: string; at: number; attempts: number }
interface Lane { intervalHours?: number; nextAt: number | null; count: number; paused: boolean; declined: boolean; failed: boolean }
export interface WakeState {
  version: 1; day: string; lastInviteAt: number; active: WakeTask | null;
  cooldowns?: Partial<Record<WakeAction, number>>;
  lanes: Record<WakeAction, Lane>; history: WakeOutcome[];
}
export const WAKE_DAY_LIMIT = 3;
export const WAKE_CHECK_MS = 60_000;
const HOUR = 3_600_000;
const freshLane = (): Lane => ({ nextAt: null, count: 0, paused: false, declined: false, failed: false });
export function localDay(at: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const part = (key: string) => parts.find(p => p.type === key)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export class WakeScheduler {
  private state: WakeState;
  constructor(private readonly file: string, private readonly now: () => number,
    private readonly random: () => number, private readonly timeZone: string) {
    this.state = { version: 1, day: this.day(), lastInviteAt: 0, active: null,
      lanes: { write: freshLane(), catch: freshLane(), remind: freshLane() }, cooldowns: {}, history: [] };
    let recovered = false;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<WakeState>;
      if (saved.version === 1 && typeof saved.day === 'string') {
        this.state.day = saved.day;
        for (const action of ACTIONS) {
          const until = saved.cooldowns?.[action];
          if (typeof until === 'number' && Number.isFinite(until)) this.state.cooldowns![action] = until;
        }
        this.state.lastInviteAt = Number.isFinite(saved.lastInviteAt) ? saved.lastInviteAt! : 0;
        for (const action of ACTIONS) {
          const lane = saved.lanes?.[action];
          if (!lane) continue;
          this.state.lanes[action] = {
            nextAt: typeof lane.nextAt === 'number' && Number.isFinite(lane.nextAt) ? lane.nextAt : null,
            count: Number.isInteger(lane.count) && lane.count >= 0 ? lane.count : 0,
            paused: lane.paused === true, declined: lane.declined === true, failed: lane.failed === true, intervalHours: this.validInterval(lane.intervalHours),
          };
        }
        this.state.history = Array.isArray(saved.history) ? saved.history.filter(item => item &&
          typeof item.id === 'string' && ACTIONS.includes(item.action) &&
          typeof item.result === 'string' && typeof item.reason === 'string' && Number.isFinite(item.at)).slice(-24) : [];
        const task = saved.active;
        if (task && typeof task.id === 'string' && ACTIONS.includes(task.action)) {
          // Deferred queue entries do not survive Core restart. Never immediately re-wake an old task.
          this.record({ ...task, attempts: Number.isFinite(task.attempts) ? task.attempts : 0 }, 'interrupted', 'world_restarted');
          this.state.lanes[task.action].nextAt = this.now() + this.delay(false, task.action);
          recovered = true;
        }
      }
    } catch { /* A new/old deployment starts without any pending invitation. */ }
    this.rollDay();
    if (recovered) this.save();
  }
  private day(): string { return localDay(this.now(), this.timeZone); }
  private validInterval(value: unknown): number { return typeof value === 'number' && Number.isFinite(value) ? Math.min(24, Math.max(2, value)) : 2; }
  private delay(retry = false, action?: WakeAction): number {
    const value = Math.max(0, Math.min(1, this.random()));
    const base = this.validInterval(action ? this.state.lanes[action].intervalHours : 2);
    return retry ? (0.5 + value * 0.5) * HOUR : Math.min(24, base + value * base) * HOUR;
  }
  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
    renameSync(temp, this.file);
  }
  private rollDay(): void {
    if (this.state.day === this.day()) return;
    if (this.state.active) this.record(this.state.active, 'cancelled', 'day_changed');
    this.state.active = null;
    this.state.day = this.day();
    for (const action of ACTIONS) {
      const { paused, intervalHours } = this.state.lanes[action];
      this.state.lanes[action] = { ...freshLane(), paused, intervalHours };
    }
    this.save();
  }
  private record(task: WakeTask, result: WakeResult, reason: string): void {
    this.state.history.push({ id: task.id, action: task.action, attempts: task.attempts, result, reason, at: this.now() });
    this.state.history = this.state.history.slice(-24);
  }
  snapshot(): WakeState { return structuredClone(this.state); }
  /** Called only by the World timer; conditions are rechecked again by render(). */
  check(eligible: Record<'write' | 'catch', boolean> & Partial<Record<'remind', boolean>>, idle: boolean): WakeTask | null {
    // Core may be paused for days: keep just one deferred item, not one per day.
    if (this.state.active?.phase === 'queued') return null;
    this.rollDay();
    const now = this.now();
    for (const action of ACTIONS) {
      const lane = this.state.lanes[action];
      if (!eligible[action] || lane.paused || lane.declined || lane.failed || lane.count >= WAKE_DAY_LIMIT) {
        if (lane.nextAt !== null) { lane.nextAt = null; this.save(); }
      } else if (lane.nextAt === null) { lane.nextAt = now + this.delay(false, action); this.save(); }
    }
    const active = this.state.active;
    if (active) {
      if (active.phase !== 'retry') {
        if (idle && active.phase !== 'queued' && now >= active.dueAt) this.uncompleted('turn_timeout');
        return null;
      }
      if (!eligible[active.action] || this.blocked(active.action)) { this.finish('cancelled', 'conditions_changed'); return null; }
      if (!idle || now < active.dueAt) return null;
      active.phase = 'queued'; this.save(); return { ...active };
    }
    if (!idle || now - this.state.lastInviteAt < HOUR) return null;
    const due = (ACTIONS).filter(action => eligible[action] && !this.blocked(action) &&
      this.state.lanes[action].nextAt !== null && now >= this.state.lanes[action].nextAt!);
    if (!due.length) return null;
    const action = due.sort((a, b) => this.state.lanes[a].nextAt! - this.state.lanes[b].nextAt!)[0];
    const task: WakeTask = { id: randomUUID(), action, phase: 'queued', attempts: 0, createdAt: now, dueAt: now };
    this.state.active = task; this.save(); return { ...task };
  }
  /** Explicit human click: same task contract, independent of the automatic daily budget. */
  invite(action: 'write' | 'catch', eligible: boolean, remote = false): WakeTask | null {
    this.rollDay();
    const lane = this.state.lanes[action];
    if (!eligible || lane.paused || lane.declined || this.state.active ||
      (this.state.cooldowns?.[action] ?? 0) > this.now()) return null;
    const task: WakeTask = { id: randomUUID(), action, phase: 'queued', attempts: 0,
      createdAt: this.now(), dueAt: this.now(), manual: true, ...(remote ? { remote: true } : {}) };
    this.state.active = task;
    this.state.cooldowns![action] = this.now() + 60_000;
    this.save(); return { ...task };
  }
  configure(action: WakeAction, hours: number): void {
    if (!Number.isFinite(hours) || hours < 2 || hours > 24) throw new Error('间隔须为 2—24 小时');
    const lane = this.state.lanes[action];
    lane.intervalHours = hours;
    if (lane.nextAt !== null) lane.nextAt = this.now() + this.delay(false, action);
    this.save();
  }
  private blocked(action: WakeAction): boolean {
    const lane = this.state.lanes[action];
    return lane.paused || lane.declined || lane.failed || lane.count >= WAKE_DAY_LIMIT;
  }
  /** A paused Core never calls this. No stale quota/text is queued in its session. */
  render(id: string, eligible: boolean): boolean {
    this.rollDay();
    const task = this.state.active;
    if (!task || task.id !== id || task.phase !== 'queued') return false;
    if (!eligible || (task.manual ? this.state.lanes[task.action].paused || this.state.lanes[task.action].declined : this.blocked(task.action))) { this.finish('cancelled', 'conditions_changed'); return false; }
    task.phase = 'rendered'; task.attempts += 1; task.dueAt = this.now() + 10 * 60_000;
    this.state.lastInviteAt = this.now();
    if (!task.manual) this.state.lanes[task.action].count += 1;
    this.save(); return true;
  }
  queueFailed(id: string): void {
    if (this.state.active?.id === id) this.finish('failed', 'queue_failed');
  }
  settled(id: string, outcome: 'delivered' | 'discarded'): void {
    const task = this.state.active;
    if (!task || task.id !== id || task.phase !== 'rendered') return;
    if (outcome === 'discarded') { this.finish('declined', 'queue_discarded'); return; }
    task.phase = 'delivered'; this.save();
  }
  turnEnded(): void {
    if (this.state.active?.phase === 'delivered') {
      if (this.state.active.action === 'remind') this.finish('completed', 'reminder_delivered');
      else this.uncompleted('no_result');
    }
  }
  private uncompleted(reason: string): void {
    const task = this.state.active;
    if (!task) return;
    if (task.action === 'remind' && task.phase === 'delivered') { this.finish('completed', 'reminder_delivered'); return; }
    this.record(task, 'uncompleted', reason);
    if (task.manual || task.attempts >= 2 || this.state.lanes[task.action].count >= WAKE_DAY_LIMIT) {
      this.finish('failed', reason); return;
    }
    task.phase = 'retry'; task.dueAt = this.now() + this.delay(true); this.save();
  }
  success(action: WakeAction): void {
    if (this.state.active?.action === action) this.finish('completed', 'tool_succeeded');
  }
  decide(action: WakeAction | undefined, reason: WakeReason): boolean {
    this.rollDay();
    const task = this.state.active;
    const current = task && (task.phase === 'rendered' || task.phase === 'delivered') ? task : null;
    // There is exactly one invitation in this turn. Voluntary deferrals settle that task,
    // even if an older model supplies the wrong action (e.g. remind for a write invite).
    if (reason === 'no_idea' || reason === 'not_now') {
      if (!current) return false;
      this.finish('deferred', reason); return true;
    }
    const target = action ?? current?.action;
    if (!target) return false;
    if (reason === 'user_paused') { this.pause(target, true); return true; }
    if (reason === 'user_declined') {
      this.state.lanes[target].declined = true;
      if (task?.action === target) this.finish('declined', reason);
      else this.save();
      return true;
    }
    return false;
  }
  pause(action: WakeAction, paused: boolean): void {
    this.rollDay();
    const lane = this.state.lanes[action];
    lane.paused = paused; lane.nextAt = paused ? null : this.now() + this.delay(false, action);
    if (!paused) { lane.declined = false; lane.failed = false; }
    if (paused && this.state.active?.action === action) this.finish('paused', 'user_paused');
    else this.save();
  }
  private finish(result: WakeResult, reason: string): void {
    const task = this.state.active;
    if (!task) return;
    this.record(task, result, reason);
    const lane = this.state.lanes[task.action];
    if (result === 'failed') lane.failed = true;
    if (result === 'declined') lane.declined = true;
    lane.nextAt = this.now() + this.delay(false, task.action);
    this.state.active = null; this.save();
  }
}
