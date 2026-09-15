/** Manual reset event: `wait()` blocks until `set()`, and stays open until `clear()`. */
export class Signal {
  private waiters: (() => void)[] = [];
  private open = false;

  get isSet(): boolean {
    return this.open;
  }

  set(): void {
    this.open = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  clear(): void {
    this.open = false;
  }

  wait(): Promise<void> {
    if (this.open) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/** Sleep that returns early when `signal` fires, so shutdown does not wait out the delay. */
export function sleep(ms: number, signal?: Signal): Promise<void> {
  if (signal === undefined) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void signal.wait().then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
