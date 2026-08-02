export interface OutboxEvent<TPayload = Record<string, unknown>> {
  id: string;
  eventType: string;
  payload: TPayload;
  attemptCount: number;
}

export interface OutboxHandler<TPayload = Record<string, unknown>> {
  name: string;
  eventType: string;
  handle(event: OutboxEvent<TPayload>): Promise<void>;
}

export interface OutboxIdempotencyStore {
  has(key: string): Promise<boolean>;
  record(key: string): Promise<void>;
}

export interface OutboxDispatcher {
  dispatch(event: OutboxEvent): Promise<{ handled: string[]; skipped: string[] }>;
}

export class InMemoryOutboxIdempotencyStore
  implements OutboxIdempotencyStore
{
  readonly keys = new Set<string>();

  async has(key: string) {
    return this.keys.has(key);
  }

  async record(key: string) {
    this.keys.add(key);
  }
}

export class DirectOutboxDispatcher implements OutboxDispatcher {
  constructor(
    private readonly handlers: OutboxHandler[],
    private readonly idempotency: OutboxIdempotencyStore,
  ) {}

  async dispatch(event: OutboxEvent) {
    const handled: string[] = [];
    const skipped: string[] = [];
    for (const handler of this.handlers.filter(
      (candidate) => candidate.eventType === event.eventType,
    )) {
      const key = `${event.id}:${handler.name}`;
      if (await this.idempotency.has(key)) {
        skipped.push(handler.name);
        continue;
      }
      await handler.handle(event);
      await this.idempotency.record(key);
      handled.push(handler.name);
    }
    return { handled, skipped };
  }
}

export function outboxRetryDelaySeconds(attemptCount: number) {
  const boundedAttempt = Math.max(0, Math.min(8, Math.trunc(attemptCount)));
  return Math.min(3600, 30 * 2 ** boundedAttempt);
}
