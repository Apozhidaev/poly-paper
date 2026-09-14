import { MessageQueue, type Fn, type EventType } from './messageQueue.js';

type Event = {
  type: EventType;
  interval: number;
};

export class Scheduler {
  private _running: boolean = false;
  private mq: MessageQueue;
  private timers: NodeJS.Timeout[];
  private events: Event[];
  private onError?: (err: Error) => void;

  constructor({
    timeout,
    mq,
    onError,
  }: { timeout?: number; mq?: MessageQueue; onError?: (err: Error) => void } = {}) {
    this.mq = mq || new MessageQueue({ timeout });
    this.timers = [];
    this.events = [];
    this.onError = onError || ((err) => console.error(err));
  }

  private onEvent(event: EventType) {
    if (!this.mq.empty(event)) return;
    this.mq.post(event).catch((err) => {
      this.onError?.(err);
    });
  }

  get busy() {
    return this.mq.busy;
  }

  get running() {
    return this._running;
  }

  register(event: EventType, interval: number) {
    this.events.push({ type: event, interval });
    const subscribe = (fn: Fn) => {
      this.subscribe(event, fn);
      return { subscribe };
    };
    return { subscribe };
  }

  subscribe(event: EventType, fn: Fn) {
    this.mq.subscribe(event, fn);
  }

  start() {
    this.events.forEach((event) => {
      this.timers.push(setInterval(() => this.onEvent(event.type), event.interval));
      this.onEvent(event.type);
    });
    this._running = true;
  }

  stop() {
    this.timers.forEach((timer) => {
      clearInterval(timer);
    });
    this.timers = [];
    this._running = false;
  }
}
