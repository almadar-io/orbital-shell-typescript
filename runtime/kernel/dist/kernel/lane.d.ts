interface LaneTurn {
    readonly ticket: number;
}
declare class LaneHeldByParkedDispatch extends Error {
    readonly ticket: number;
    readonly event: string;
    constructor(ticket: number, event: string);
}
interface LaneGuard {
    readonly turn: LaneTurn;
    park(event: string): void;
    resume(): void;
    release(): void;
}
declare class DispatchLane {
    private nextTicket;
    private holder;
    private depth;
    private parkedEvent;
    private readonly waiters;
    assertCanReenter(turn: LaneTurn): void;
    enter(turn?: LaneTurn): Promise<LaneGuard>;
    private take;
    private guard;
}

export { DispatchLane, type LaneGuard, LaneHeldByParkedDispatch, type LaneTurn };
