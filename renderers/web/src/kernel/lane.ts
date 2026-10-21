export interface LaneTurn {
  readonly ticket: number;
}

export class LaneHeldByParkedDispatch extends Error {
  readonly ticket: number;
  readonly event: string;

  constructor(ticket: number, event: string) {
    super(
      `dispatch #${ticket} (${event}) is parked holding the dispatch lane on this thread; resume or drop it before starting another dispatch`,
    );
    this.name = 'LaneHeldByParkedDispatch';
    this.ticket = ticket;
    this.event = event;
  }
}

export interface LaneGuard {
  readonly turn: LaneTurn;
  park(event: string): void;
  resume(): void;
  release(): void;
}

interface Waiter {
  readonly turn: LaneTurn;
  readonly grant: () => void;
}

export class DispatchLane {
  private nextTicket = 0;
  private holder: LaneTurn | undefined;
  private depth = 0;
  private parkedEvent: string | undefined;
  private readonly waiters: Waiter[] = [];

  async enter(turn?: LaneTurn): Promise<LaneGuard> {
    const holder = this.holder;
    if (holder !== undefined && turn === holder) {
      if (this.parkedEvent !== undefined) {
        throw new LaneHeldByParkedDispatch(holder.ticket, this.parkedEvent);
      }
      this.depth += 1;
      return this.guard(holder, false);
    }
    const own: LaneTurn = { ticket: this.nextTicket };
    this.nextTicket += 1;
    if (this.holder === undefined) {
      this.take(own);
    } else {
      await new Promise<void>((grant) => {
        this.waiters.push({ turn: own, grant });
      });
    }
    return this.guard(own, true);
  }

  private take(turn: LaneTurn): void {
    this.holder = turn;
    this.depth = 1;
    this.parkedEvent = undefined;
  }

  private guard(turn: LaneTurn, outer: boolean): LaneGuard {
    let done = false;
    return {
      turn,
      park: (event) => {
        if (!done && outer && this.holder === turn && this.depth === 1) this.parkedEvent = event;
      },
      resume: () => {
        if (!done && outer && this.holder === turn) this.parkedEvent = undefined;
      },
      release: () => {
        if (done) return;
        done = true;
        if (this.holder !== turn) return;
        this.depth -= 1;
        if (this.depth > 0) return;
        this.holder = undefined;
        this.parkedEvent = undefined;
        const next = this.waiters.shift();
        if (next !== undefined) {
          this.take(next.turn);
          next.grant();
        }
      },
    };
  }
}
