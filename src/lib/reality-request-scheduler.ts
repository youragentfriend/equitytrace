export function createRealityRequestScheduler(intervalMs: number) {
  const lastStartedAt = new Map<string, number>();
  const queues = new Map<string, Promise<void>>();
  const pending = new Map<string, Promise<unknown>>();

  return function schedule<T>(path: string, request: () => Promise<T>): Promise<T> {
    const shared = pending.get(path) as Promise<T> | undefined;
    if (shared) return shared;

    const endpoint = path.split("?", 1)[0];
    const previous = queues.get(endpoint) ?? Promise.resolve();
    const start = previous.then(async () => {
      const remaining = intervalMs - (Date.now() - (lastStartedAt.get(endpoint) ?? 0));
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      lastStartedAt.set(endpoint, Date.now());
    });
    queues.set(endpoint, start);
    const current = start.then(request);
    pending.set(path, current);
    void current.then(
      () => { if (pending.get(path) === current) pending.delete(path); },
      () => { if (pending.get(path) === current) pending.delete(path); },
    );
    return current;
  };
}
