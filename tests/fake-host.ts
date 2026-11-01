/** World 测试共用的假宿主：记录推送的事件与投递口径，其余宿主接口都是空实现。 */
import type { EventEnvelope, PushOptions, WorldHost } from 'cortico/core/types.ts';

export class FakeHost implements WorldHost {
  events: EventEnvelope[] = [];
  pushOpts: Array<PushOptions | undefined> = [];

  store = {
    get: () => undefined,
    latestCursor: () => 0,
    range: () => [],
    around: () => [],
    grep: () => [],
  } as unknown as WorldHost['store'];

  blob = (): { bytes: Uint8Array; mime: string } | null => null;
  modelFacts = { model: () => 'test', accepts: () => false, contextWindow: () => 128000 };
  log = {
    child() {
      return this;
    },
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    emit() {},
  } as unknown as WorldHost['log'];

  deferred: Array<Parameters<WorldHost['pushDeferred']>[0]> = [];
  pushDeferred(event: Parameters<WorldHost['pushDeferred']>[0]): void { this.deferred.push(event); }
  async deliverDeferred(world: { onEventsSettled(events: readonly EventEnvelope[], outcome: 'delivered' | 'discarded'): void }): Promise<EventEnvelope[]> {
    const delivered: EventEnvelope[] = [];
    for (const spec of this.deferred.splice(0)) {
      const rendered = await spec.render();
      if (rendered === null) continue;
      const event = await this.pushEvent({ type: spec.type, source: 'bottle', ts: new Date().toISOString(),
        origin: spec.origin, meta: spec.meta, text: typeof rendered === 'string' ? rendered : rendered.text });
      delivered.push(event);
    }
    world.onEventsSettled(delivered, 'delivered');
    return delivered;
  }
  reportUsage(): void {}

  async pushEvent(
    e: Omit<EventEnvelope, 'cursor' | 'origin' | 'contextDelivery' | 'blobs'> & { origin?: 'internal' | 'external' },
    opts?: PushOptions,
  ): Promise<EventEnvelope> {
    const full = { ...e, origin: e.origin ?? 'external', cursor: this.events.length + 1 } as EventEnvelope;
    this.events.push(full);
    this.pushOpts.push(opts);
    return full;
  }

  async drainPendingEvents(): Promise<EventEnvelope[]> {
    return [];
  }

  last(type: string): EventEnvelope | undefined {
    return [...this.events].reverse().find((event) => event.type === type);
  }
}
