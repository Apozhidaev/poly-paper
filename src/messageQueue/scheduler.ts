import { MessageQueue, type Fn, type EventType } from './messageQueue.js';

type Event = {
  type: EventType;
  interval: number;
};

/**
 * Periodic publisher on top of {@link MessageQueue}. Each registered event is posted on its
 * interval, but only when the previous job of that same type has finished — see
 * {@link MessageQueue.empty}.
 */
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

  /**
   * Interval tick: skip if this event type is already queued or running, otherwise enqueue it.
   * That way a slow handler just misses intervals instead of flooding the queue.
   */
  private onEvent(event: EventType) {
    if (!this.mq.empty(event)) return;
    this.mq.post(event).catch((err) => {
      this.onError?.(err);
    });
  }

  /** Whether the underlying message queue is currently draining. */
  get busy() {
    return this.mq.busy;
  }

  /** Whether {@link start} has been called and timers are armed. */
  get running() {
    return this._running;
  }

  /**
   * Declare a periodic event. Call `.subscribe(fn)` on the return value to attach a handler
   * before {@link start}.
   */
  register(event: EventType, interval: number) {
    this.events.push({ type: event, interval });
    const subscribe = (fn: Fn) => {
      this.subscribe(event, fn);
      return { subscribe };
    };
    return { subscribe };
  }

  /** Attach a handler for a previously {@link register}ed event type. */
  subscribe(event: EventType, fn: Fn) {
    this.mq.subscribe(event, fn);
  }

  /** Arm all registered intervals and fire each event once immediately. */
  start() {
    this.events.forEach((event) => {
      this.timers.push(setInterval(() => this.onEvent(event.type), event.interval));
      this.onEvent(event.type);
    });
    this._running = true;
  }

  /** Clear all interval timers. Does not destroy the message queue. */
  stop() {
    this.timers.forEach((timer) => {
      clearInterval(timer);
    });
    this.timers = [];
    this._running = false;
  }
}
