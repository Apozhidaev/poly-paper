/** One-shot-until-cleared event: `wait()` resolves while the signal is set. */
export class Signal {
  private flag = false;
  private waiters: (() => void)[] = [];

  get isSet(): boolean {
    return this.flag;
  }

  set(): void {
    if (this.flag) return;
    this.flag = true;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }

  clear(): void {
    this.flag = false;
  }

  async wait(): Promise<void> {
    if (this.flag) return;
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

/** Sleep for `ms`, cutting the wait short as soon as `wakeUp` is set. */
export async function sleep(ms: number, wakeUp?: Signal): Promise<void> {
  if (wakeUp === undefined) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }
  if (wakeUp.isSet) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void wakeUp.wait().then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
