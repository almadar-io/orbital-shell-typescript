// src/kernel/lane.ts
var LaneHeldByParkedDispatch = class extends Error {
  ticket;
  event;
  constructor(ticket, event) {
    super(
      `dispatch #${ticket} (${event}) is parked holding the dispatch lane on this thread; resume or drop it before starting another dispatch`
    );
    this.name = "LaneHeldByParkedDispatch";
    this.ticket = ticket;
    this.event = event;
  }
};
var DispatchLane = class {
  nextTicket = 0;
  holder;
  depth = 0;
  parkedEvent;
  waiters = [];
  assertCanReenter(turn) {
    if (this.holder === turn && this.parkedEvent !== void 0) throw new LaneHeldByParkedDispatch(turn.ticket, this.parkedEvent);
  }
  async enter(turn) {
    const holder = this.holder;
    if (holder !== void 0 && turn === holder) {
      if (this.parkedEvent !== void 0) {
        throw new LaneHeldByParkedDispatch(holder.ticket, this.parkedEvent);
      }
      this.depth += 1;
      return this.guard(holder, false);
    }
    const own = { ticket: this.nextTicket };
    this.nextTicket += 1;
    if (this.holder === void 0) {
      this.take(own);
    } else {
      await new Promise((grant) => {
        this.waiters.push({ turn: own, grant });
      });
    }
    return this.guard(own, true);
  }
  take(turn) {
    this.holder = turn;
    this.depth = 1;
    this.parkedEvent = void 0;
  }
  guard(turn, outer) {
    let done = false;
    return {
      turn,
      park: (event) => {
        if (!done && outer && this.holder === turn && this.depth === 1) this.parkedEvent = event;
      },
      resume: () => {
        if (!done && outer && this.holder === turn) this.parkedEvent = void 0;
      },
      release: () => {
        if (done) return;
        done = true;
        if (this.holder !== turn) return;
        this.depth -= 1;
        if (this.depth > 0) return;
        this.holder = void 0;
        this.parkedEvent = void 0;
        const next = this.waiters.shift();
        if (next !== void 0) {
          this.take(next.turn);
          next.grant();
        }
      }
    };
  }
};

export { DispatchLane, LaneHeldByParkedDispatch };
