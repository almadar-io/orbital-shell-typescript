import { expect, test } from 'vitest';
import { DispatchLane, LaneHeldByParkedDispatch } from '../src/kernel/lane.js';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function run(lane: DispatchLane, name: string, log: string[], gate?: Promise<void>): Promise<void> {
  const guard = await lane.enter();
  log.push(`${name}:start`);
  if (gate !== undefined) {
    guard.park(name);
    await gate;
    guard.resume();
  }
  log.push(`${name}:end`);
  guard.release();
}

test('two_overlapping_dispatches_land_in_arrival_order', async () => {
  const lane = new DispatchLane();
  const log: string[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const a = run(lane, 'A', log, gate);
  const b = run(lane, 'B', log);
  const c = run(lane, 'C', log);
  await flush();
  expect(log).toEqual(['A:start']);
  open();
  await Promise.all([a, b, c]);
  expect(log).toEqual(['A:start', 'A:end', 'B:start', 'B:end', 'C:start', 'C:end']);
});

test('control_a_free_lane_grants_immediately', async () => {
  const lane = new DispatchLane();
  const log: string[] = [];
  await run(lane, 'A', log);
  await run(lane, 'B', log);
  expect(log).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
});

test('a_dispatch_parked_on_an_unkeyed_ask_keeps_the_lane_until_it_commits', async () => {
  const lane = new DispatchLane();
  const log: string[] = [];
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  const a = run(lane, 'A', log, gate);
  const b = run(lane, 'B', log);
  await flush();
  await flush();
  expect(log).toEqual(['A:start']);
  open();
  await Promise.all([a, b]);
  expect(log).toEqual(['A:start', 'A:end', 'B:start', 'B:end']);
});

test('a_new_dispatch_carrying_the_parked_holders_turn_is_refused_not_hung', async () => {
  const lane = new DispatchLane();
  const holder = await lane.enter();
  holder.park('CALL');
  const outcome = await Promise.race([
    lane.enter(holder.turn).then(() => 'granted', (e: Error) => e),
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 200)),
  ]);
  expect(outcome).toBeInstanceOf(LaneHeldByParkedDispatch);
  if (outcome instanceof LaneHeldByParkedDispatch) {
    expect(outcome.name).toBe('LaneHeldByParkedDispatch');
    expect(outcome.message).toBe(
      'dispatch #0 (CALL) is parked holding the dispatch lane on this thread; resume or drop it before starting another dispatch',
    );
  }
  holder.release();
});

test('control_a_running_holder_re_enters_freely_and_an_untokened_caller_queues', async () => {
  const lane = new DispatchLane();
  const holder = await lane.enter();
  const inner = await lane.enter(holder.turn);
  const log: string[] = [];
  const other = run(lane, 'C', log);
  inner.release();
  await flush();
  expect(log).toEqual([]);
  holder.release();
  await other;
  expect(log).toEqual(['C:start', 'C:end']);
});

test('control_an_abandoned_parked_dispatch_releases_the_lane', async () => {
  const lane = new DispatchLane();
  const holder = await lane.enter();
  holder.park('CALL');
  const log: string[] = [];
  const b = run(lane, 'B', log);
  await flush();
  expect(log).toEqual([]);
  holder.release();
  holder.release();
  await b;
  expect(log).toEqual(['B:start', 'B:end']);
  const again = await lane.enter(holder.turn);
  again.release();
});
