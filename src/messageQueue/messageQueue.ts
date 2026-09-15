export type Fn = (...args: any) => any;
export type EventType = string | symbol;

type Message = {
  event: EventType;
  args: any[];
  resolve?: (results: any[]) => void;
  reject?: (error: any) => void;
};

type Subscription = {
  fn: Fn;
  timeout?: number;
};

export class EventError extends Error {
  public event: EventType;
  constructor(message: string, event: EventType, err?: Error) {
    super(`${message} event: ${String(event)}${err ? ` - ${err.message}` : ''}`, { cause: err });
    this.event = event;
  }
}

export class MessageQueue {
  private _busy: boolean;
  private timeout: number;
  private subscriptions: Record<EventType, Subscription[]>;
  private messages: Message[];
  private timerId: NodeJS.Timeout;
  private inProgress?: Message;
  private onError?: (err: EventError) => void;

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

  get busy() {
    return this._busy;
  }

  public unsubscribe(event: EventType, fn: Fn) {
    if (this.subscriptions[event]) {
      this.subscriptions[event] = this.subscriptions[event].filter((x) => x.fn !== fn);
    }
  }

  public subscribe(event: EventType, fn: Fn, timeout?: number) {
    if (!this.subscriptions[event]) {
      this.subscriptions[event] = [];
    }
    this.subscriptions[event].push({ fn, timeout });
    return () => this.unsubscribe(event, fn);
  }

  public post<T = any>(event: EventType, ...args: any[]) {
    return new Promise<T[]>((resolve, reject) => {
      this.messages.push({
        event,
        args,
        resolve,
        reject,
      });
    });
  }

  public push(event: EventType, ...args: any[]) {
    this.messages.push({
      event,
      args,
      reject: this.onError,
    });
  }

  public pending(event: EventType) {
    return this.messages.some((x) => x.event === event);
  }

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

  public destroy() {
    clearInterval(this.timerId);
    this._busy = false;
  }
}
