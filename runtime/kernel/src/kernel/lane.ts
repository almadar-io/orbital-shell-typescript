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
