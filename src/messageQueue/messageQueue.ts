export type Fn = (...args: any) => any;
export type EventType = string | symbol;

type Message = {
  event: EventType;
  args: any[];
  resolve?: (results: any) => void;
  reject?: (error: any) => void;
};

type Subscription = {
  fn: Fn;
  timeout?: number;
};

/** Error raised while dispatching or timing out a queued event. */
export class EventError extends Error {
  public event: EventType;
  constructor(message: string, event: EventType, err?: Error) {
    super(`${message} event: ${String(event)}${err ? ` - ${err.message}` : ''}`, { cause: err });
    this.event = event;
  }
}

/**
 * Single-consumer event queue: handlers for a given event type run one after another, never
 * in parallel. The poller drains `messages` on an interval while `_busy` is false.
 */
export class MessageQueue {
  private _busy: boolean;
  private timeout: number;
  private subscriptions: Record<EventType, Subscription[]>;
  private messages: Message[];
  private timerId: NodeJS.Timeout;
  private inProgress?: Message;
  private onError?: (err: EventError) => void;

  /**
   * @param interval - How often (ms) to check for queued messages. Default 250.
   * @param timeout - Per-handler deadline (ms). Default 1 hour.
   * @param onError - Called for fire-and-forget failures from {@link push}.
   */
  constructor({
    interval = 250,
    timeout = 60 * 60 * 1000,
    onError,
  }: { interval?: number; timeout?: number; onError?: (err: EventError) => void } = {}) {
    this.timeout = timeout;
    this.subscriptions = {};
    this.messages = [];
    this._busy = false;
    this.onError = onError || ((err) => console.error(err));
    this.timerId = setInterval(() => {
      if (this._busy) return;
      if (this.messages.length > 0) {
        this._busy = true;
        this.processMessages().then(() => {
          this._busy = false;
        });
      }
    }, interval);
  }

  /** Invoke one subscriber with a timeout that is cleared once the handler settles. */
  private send({
    fn,
    timeout,
    event,
    args,
  }: {
    fn: Fn;
    timeout?: number;
    event: EventType;
    args: any[];
  }) {
    return new Promise((resolve, reject) => {
      // The timer is cleared once the handler settles: with a one-second tick, leaving it
      // armed for the whole timeout would pile up thousands of pending timers.
      const timer = setTimeout(() => {
        reject(new EventError('Send message timeout', event));
      }, timeout || this.timeout);
      const settle = (fn: (value: any) => void) => (value: any) => {
        clearTimeout(timer);
        fn(value);
      };
      Promise.resolve(fn(...args)).then(settle(resolve), settle(reject));
    });
  }

  /** Run every subscriber for `event` sequentially and collect their return values. */
  private async report({ event, args }: { event: EventType; args: any[] }) {
    const results: any[] = [];
    if (this.subscriptions[event]) {
      for (let i = 0; i < this.subscriptions[event].length; i++) {
        const { fn, timeout } = this.subscriptions[event][i];
        const result = await this.send({ fn, timeout, event, args });
        results.push(result);
      }
    }
    return results;
  }

  /** Drain the queue: each message is fully handled before the next is taken. */
  private async processMessages() {
    this.inProgress = this.messages.shift();
    while (this.inProgress) {
      const { event, args, resolve, reject } = this.inProgress;
      try {
       const results = await this.report({ event, args });
        resolve?.(results);
      } catch (err) {
        reject?.(new EventError('Process messages', event, err as Error));
      }
      this.inProgress = this.messages.shift();
    }
  }

  /** Whether the poller is currently draining the queue. */
  get busy() {
    return this._busy;
  }

  /** Remove a previously registered handler for `event`. */
  public unsubscribe(event: EventType, fn: Fn) {
    if (this.subscriptions[event]) {
      this.subscriptions[event] = this.subscriptions[event].filter((x) => x.fn !== fn);
    }
  }

  /**
   * Register a handler for `event`. Handlers for the same event run sequentially.
   *
   * @returns Unsubscribe function for this specific handler.
   */
  public subscribe(event: EventType, fn: Fn, timeout?: number) {
    if (!this.subscriptions[event]) {
      this.subscriptions[event] = [];
    }
    this.subscriptions[event].push({ fn, timeout });
    return () => this.unsubscribe(event, fn);
  }

  /**
   * Enqueue `event` and wait until all of its subscribers have finished.
   * Resolves with an array of their return values (one per subscriber).
   */
  public post<T extends any[] = any[]>(event: EventType, ...args: any[]) {
    return new Promise<T>((resolve, reject) => {
      this.messages.push({
        event,
        args,
        resolve,
        reject,
      });
    });
  }

  /**
   * Fire-and-forget enqueue. Failures go to the constructor's `onError` callback;
   * there is no promise for the caller.
   */
  public push(event: EventType, ...args: any[]) {
    this.messages.push({
      event,
      args,
      reject: this.onError,
    });
  }

  /** Whether at least one queued (not yet started) message has this `event` type. */
  public pending(event: EventType) {
    return this.messages.some((x) => x.event === event);
  }

  /**
   * Whether the queue has no work for the given events — neither waiting nor in flight.
   *
   * - No arguments: `true` only if the entire queue is idle (`messages` empty and nothing
   *   in `inProgress`).
   * - With event types: `true` if **none** of those types are queued or currently being
   *   processed. Other event types still in the queue do not affect the result.
   *
   * Used by {@link Scheduler} to skip posting a tick while a previous tick of the same
   * type is still outstanding, so slow handlers do not pile up duplicate jobs.
   */
  public empty(...events: EventType[]) {
    if (events.length) {
      for (let i = 0; i < events.length; i++) {
        const event = events[i];
        if (this.pending(event) || (this.inProgress && this.inProgress.event === event))
          return false;
      }
      return true;
    }
    return this.messages.length === 0 && !this.inProgress;
  }

  /** Stop the poller interval. In-flight work is not cancelled. */
  public destroy() {
    clearInterval(this.timerId);
    this._busy = false;
  }
}
