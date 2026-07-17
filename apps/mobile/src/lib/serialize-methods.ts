/**
 * Serialize every prototype method of an instance through one promise queue: each call runs
 * strictly after the previous one settles.
 *
 * For the AsyncStorage-backed stores: every document mutation is an async read-modify-write, and
 * callers run concurrently (the embedded router handles a bulk series download's many enqueues at
 * once) — two interleaved writers on the same doc meant last-writer-wins, silently dropping records
 * (the "chapter not downloaded" crash). The queue is the transaction. The server's file stores dodge
 * this with in-memory cache maps; on-device this wrapper is the equivalent guarantee.
 */
export function serializeAsyncMethods(instance: object): void {
  let queue: Promise<unknown> = Promise.resolve();
  const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const fn = proto[name];
    if (typeof fn !== 'function') continue;
    const method = fn as (...args: unknown[]) => unknown;
    (instance as Record<string, unknown>)[name] = (...args: unknown[]) => {
      const op = () => Promise.resolve(method.apply(instance, args));
      const next = queue.then(op, op);
      queue = next.catch(() => {});
      return next;
    };
  }
}
