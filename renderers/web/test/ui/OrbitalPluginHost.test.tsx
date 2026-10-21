// @vitest-environment jsdom
/**
 * OrbitalPluginHost — a real local kernel end to end (Almadar Studio
 * V4 §14 plan, P2 F1/F5). A minimal 2-state `PingOrbital` schema stands in
 * for a `.lolo` plugin: `IDLE --PING--> PONGED` echoes both its own trigger
 * (dropped by the echo guard) and `PONG` (re-emitted), and persists a
 * `PingRecord` row so the default-vs-`deny:['persist']` behavior is real.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { OrbitalSchema } from '@almadar/core';
import { asEventId } from '@almadar/core';
import { EventBusProvider } from '../../src/core';
import { useEventBus, type EventBusContextType } from '../../src/core';
import { UISlotProvider, useUISlots } from '../../src/providers/UISlotContext';
import { UISlotComponent } from '../../src/components/core/organisms/UISlotRenderer';
import {
  OrbitalPluginHost,
  useOrbitalPluginHost,
  useDeclaredCaptureTable,
  type PluginHostPlugin,
} from '../../src/preview/OrbitalPluginHost';

function pingSchema(): OrbitalSchema {
  return {
    name: 'ping-plugin',
    orbitals: [
      {
        name: 'PingOrbital',
        entity: { name: 'PingerData', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [
          {
            name: 'Pinger',
            scope: 'instance',
            linkedEntity: 'PingerData',
            stateMachine: {
              states: [{ name: 'IDLE', isInitial: true }, { name: 'PONGED' }],
              events: [{ key: 'PING', name: 'PING' }, { key: 'RESET', name: 'RESET' }],
              transitions: [
                {
                  from: 'IDLE',
                  to: 'PONGED',
                  event: 'PING',
                  effects: [
                    ['emit', 'PING', {}],
                    ['emit', 'PONG', {}],
                    ['persist', 'create', 'PingRecord', {}],
                  ],
                },
                { from: 'PONGED', to: 'IDLE', event: 'RESET', effects: [] },
              ],
            },
            emits: [{ event: 'PONG', scope: 'external' }],
            listens: [{ event: 'PING', triggers: 'PING' }, { event: 'RESET', triggers: 'RESET' }],
            config: {
              keymap: { type: 'map', default: { IDLE: ['p'], PONGED: ['r'] } },
            },
          },
        ],
      },
    ],
  };
}

function pingPlugin(): PluginHostPlugin {
  return {
    id: 'ping',
    schema: pingSchema(),
    inbound: [{ busEvent: 'PING', orbital: 'PingOrbital', trait: 'Pinger', trigger: 'PING' }],
  };
}

/**
 * Two-trait intra-orbital cascade shaped like a composed/`uses`-resolved
 * plugin (e.g. vim-mode's `Shell` → `VimStudioBridge`): `Emitter`'s own
 * `emits[]` contract carries a V4 ledger `eventId` for `PING`, while
 * `Receiver`'s source-qualified `listens { Emitter PING -> RECV }` entry
 * does not carry one — the exact partial-ledger shape `orb resolve`
 * produces (`docs/Almadar_Runtime_Gaps.md`, composed-trait listen routing).
 * Regression for composed-trait listen routing: the
 * cascade must still fire even though only one side of the listen/emit
 * pair carries an id.
 */
function cascadeSchema(): OrbitalSchema {
  return {
    name: 'cascade-plugin',
    orbitals: [
      {
        name: 'CascadeOrbital',
        entity: { name: 'CascadeData', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [
          {
            name: 'Emitter',
            scope: 'instance',
            linkedEntity: 'CascadeData',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'FIRE', name: 'FIRE' }],
              transitions: [
                { from: 'idle', to: 'idle', event: 'FIRE', effects: [['emit', 'PING', {}]] },
              ],
            },
            emits: [{ event: 'PING', eventId: asEventId('evt_cascade_ping'), scope: 'external' }],
            listens: [{ event: 'FIRE', triggers: 'FIRE' }],
          },
          {
            name: 'Receiver',
            scope: 'instance',
            linkedEntity: 'CascadeData',
            stateMachine: {
              states: [{ name: 'waiting', isInitial: true }, { name: 'received' }],
              events: [{ key: 'RECV', name: 'RECV' }],
              transitions: [
                // The cascade-fired sibling's OWN outbound emit — the shape
                // the vim-mode repro actually hit (`VimStudioBridge`'s
                // `ENABLED` arm emitting `STATUS` after being cascaded into
                // by `Shell`'s relay, never the directly-dispatched trait).
                { from: 'waiting', to: 'received', event: 'RECV', effects: [['emit', 'ACK', {}]] },
              ],
            },
            emits: [{ event: 'ACK', scope: 'external' }],
            // Source-qualified, no `eventId` of its own — only `source`.
            listens: [{ event: 'PING', triggers: 'RECV', source: { kind: 'trait', trait: 'Emitter' } }],
          },
        ],
      },
    ],
  };
}

function cascadePlugin(): PluginHostPlugin {
  return {
    id: 'cascade',
    schema: cascadeSchema(),
    inbound: [{ busEvent: 'FIRE', orbital: 'CascadeOrbital', trait: 'Emitter', trigger: 'FIRE' }],
  };
}

/**
 * The relay-loop repro (Almadar Studio V4 host-protocol shape, e.g.
 * `studio-shell`'s `Shell` trait): trait `A` is the one the host's inbound
 * row actually targets, and its busEvent name (`PING`) DIFFERS from the
 * internal trigger (`HOST_PING`) — exactly like a RELAY trait whose arm
 * re-emits the same bus vocabulary word for a sibling's `listens {}`, not
 * for the host. Trait `B` listens on `A`'s `PING` (source-qualified,
 * runtime-internal cascade) and emits `PONG`. Before the relay-rule fix,
 * the host re-broadcast `A`'s `PING` re-emit as `UI:PING` — the same event
 * its own `bus.on('UI:PING', …)` listener is armed for — an infinite
 * synchronous loop.
 */
function relaySchema(): OrbitalSchema {
  return {
    name: 'relay-plugin',
    orbitals: [
      {
        name: 'RelayOrbital',
        entity: { name: 'RelayData', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [
          {
            name: 'A',
            scope: 'instance',
            linkedEntity: 'RelayData',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'HOST_PING', name: 'HOST_PING' }],
              transitions: [
                { from: 'idle', to: 'idle', event: 'HOST_PING', effects: [['emit', 'PING', {}]] },
              ],
            },
            emits: [{ event: 'PING', scope: 'external' }],
            listens: [{ event: 'HOST_PING', triggers: 'HOST_PING' }],
          },
          {
            name: 'B',
            scope: 'instance',
            linkedEntity: 'RelayData',
            stateMachine: {
              states: [{ name: 'waiting', isInitial: true }, { name: 'ponged' }],
              events: [{ key: 'PONGED', name: 'PONGED' }],
              transitions: [
                { from: 'waiting', to: 'ponged', event: 'PONGED', effects: [['emit', 'PONG', {}]] },
              ],
            },
            emits: [{ event: 'PONG', scope: 'external' }],
            listens: [{ event: 'PING', triggers: 'PONGED', source: { kind: 'trait', trait: 'A' } }],
          },
        ],
      },
    ],
  };
}

function relayPlugin(): PluginHostPlugin {
  return {
    id: 'relay',
    schema: relaySchema(),
    inbound: [{ busEvent: 'PING', orbital: 'RelayOrbital', trait: 'A', trigger: 'HOST_PING' }],
  };
}

/**
 * Slot-restore-on-unmount repro (U-PLUGIN-SLOT-RESTORE-ON-UNMOUNT):
 * `IDLE --PING--> RENDERED` renders `typography` (`content: 'plugin'`) into
 * `sidebar`; `RENDERED --CLEAR--> IDLE` clears it via a `null`-pattern
 * `render-ui`, exercising the source-scoped `pattern === null` branch
 * directly rather than only through unmount teardown.
 */
function sidebarPluginSchema(): OrbitalSchema {
  return {
    name: 'sidebar-plugin',
    orbitals: [
      {
        name: 'SidebarOrbital',
        entity: { name: 'SidebarData', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [
          {
            name: 'SidebarPlugin',
            scope: 'instance',
            linkedEntity: 'SidebarData',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }, { name: 'rendered' }],
              events: [{ key: 'PING', name: 'PING' }, { key: 'CLEAR', name: 'CLEAR' }],
              transitions: [
                {
                  from: 'idle',
                  to: 'rendered',
                  event: 'PING',
                  effects: [['render-ui', 'sidebar', { type: 'typography', content: 'plugin' }]],
                },
                {
                  from: 'rendered',
                  to: 'idle',
                  event: 'CLEAR',
                  effects: [['render-ui', 'sidebar', null]],
                },
              ],
            },
            emits: [],
            listens: [{ event: 'PING', triggers: 'PING' }, { event: 'CLEAR', triggers: 'CLEAR' }],
          },
        ],
      },
    ],
  };
}

function sidebarPlugin(): PluginHostPlugin {
  return {
    id: 'sidebar-plugin',
    schema: sidebarPluginSchema(),
    inbound: [
      { busEvent: 'PING', orbital: 'SidebarOrbital', trait: 'SidebarPlugin', trigger: 'PING' },
      { busEvent: 'CLEAR', orbital: 'SidebarOrbital', trait: 'SidebarPlugin', trigger: 'CLEAR' },
    ],
  };
}

/** Seeds a second, non-plugin source ('other') into `sidebar` via the live `useUISlots()` manager. */
function OtherSourceSeeder(): null {
  const slots = useUISlots();
  React.useEffect(() => {
    slots.render({ target: 'sidebar', pattern: 'typography', props: { content: 'other' }, sourceTrait: 'other' });
  }, [slots]);
  return null;
}

function CaptureTableProbe() {
  const table = useDeclaredCaptureTable({ pluginId: 'ping', orbital: 'PingOrbital', trait: 'Pinger' });
  return <div data-testid="capture-table" data-json={JSON.stringify({ ...table.shell, keys: Array.from(table.shell.keys) })} />;
}

function renderHost(opts: { deny?: Array<'persist' | 'call-service' | 'navigate'>; onTransition?: (...args: unknown[]) => void; withCaptureTable?: boolean; plugins?: PluginHostPlugin[] } = {}) {
  const onTransition = opts.onTransition ?? vi.fn();
  let bus!: EventBusContextType;
  function BusGrabber() {
    bus = useEventBus();
    return null;
  }
  let getHost!: ReturnType<typeof useOrbitalPluginHost>;
  function HostGrabber() {
    getHost = useOrbitalPluginHost();
    return null;
  }
  const utils = render(
    <EventBusProvider isolated>
      <UISlotProvider>
        <OrbitalPluginHost plugins={opts.plugins ?? [pingPlugin()]} deny={opts.deny} onTransition={onTransition}>
          <BusGrabber />
          <HostGrabber />
          {opts.withCaptureTable ? <CaptureTableProbe /> : null}
        </OrbitalPluginHost>
      </UISlotProvider>
    </EventBusProvider>,
  );
  return { bus, host: () => getHost, onTransition, ...utils };
}

describe('OrbitalPluginHost', () => {
  it('dispatches an inbound bus event through the real runtime and re-emits PONG with source, dropping the PING echo', async () => {
    const { bus } = renderHost();
    const pongListener = vi.fn();
    const pingListener = vi.fn();
    bus.on('UI:PONG', pongListener);
    bus.on('UI:PING', pingListener);

    bus.emit('UI:PING', {});
    expect(pingListener).toHaveBeenCalledTimes(1); // our own manual emit

    await waitFor(() => expect(pongListener).toHaveBeenCalledTimes(1));

    expect(pongListener.mock.calls[0][0].source?.orbital).toBe('PingOrbital');
    expect(pingListener).toHaveBeenCalledTimes(1); // no bounce from the echo guard
  });

  it('reflects the transition through useOrbitalPluginHost().getState and calls onTransition', async () => {
    const { bus, host, onTransition } = renderHost();

    await waitFor(() => expect(host().getState('ping', 'PingOrbital', 'Pinger')?.currentState).toBe('IDLE'));

    bus.emit('UI:PING', {});

    await waitFor(() => expect(host().getState('ping', 'PingOrbital', 'Pinger')?.currentState).toBe('PONGED'));
    expect(onTransition).toHaveBeenCalledWith('ping', 'PingOrbital', 'Pinger', 'PONGED');
  });

  it('default (no deny) persists successfully and still transitions', async () => {
    const { bus, host } = renderHost();

    bus.emit('UI:PING', {});

    await waitFor(() => expect(host().getState('ping', 'PingOrbital', 'Pinger')?.currentState).toBe('PONGED'));
    expect(host().errors.ping).toBeUndefined();
  });

  it('deny:["persist"] logs and still transitions (never throws)', async () => {
    const { bus, host } = renderHost({ deny: ['persist'] });

    bus.emit('UI:PING', {});

    await waitFor(() => expect(host().getState('ping', 'PingOrbital', 'Pinger')?.currentState).toBe('PONGED'));
    expect(host().errors.ping).toBeUndefined();
  });

  it('useDeclaredCaptureTable follows currentState through the declared keymap config', async () => {
    const { bus, getByTestId } = renderHost({ withCaptureTable: true });

    const readTable = () => JSON.parse(getByTestId('capture-table').dataset.json ?? '{}') as { mode: string; keys: string[] };

    await waitFor(() => expect(readTable().mode).toBe('IDLE'));
    expect(readTable().keys).toEqual(['p']);

    bus.emit('UI:PING', {});

    await waitFor(() => expect(readTable().mode).toBe('PONGED'));
    expect(readTable().keys).toEqual(['r']);
  });

  it('useDeclaredCaptureTable with a target ARRAY repeats the same entry under every target', async () => {
    function MultiTargetProbe() {
      const table = useDeclaredCaptureTable({
        pluginId: 'ping',
        orbital: 'PingOrbital',
        trait: 'Pinger',
        target: ['schema', 'file:a.md'],
      });
      return (
        <div
          data-testid="multi-capture-table"
          data-json={JSON.stringify({
            schema: { ...table.schema, keys: Array.from(table.schema.keys) },
            file: { ...table['file:a.md'], keys: Array.from(table['file:a.md'].keys) },
          })}
        />
      );
    }
    const utils = render(
      <EventBusProvider isolated>
        <UISlotProvider>
          <OrbitalPluginHost plugins={[pingPlugin()]}>
            <MultiTargetProbe />
          </OrbitalPluginHost>
        </UISlotProvider>
      </EventBusProvider>,
    );

    const readTable = () =>
      JSON.parse(utils.getByTestId('multi-capture-table').dataset.json ?? '{}') as {
        schema: { mode: string; keys: string[] };
        file: { mode: string; keys: string[] };
      };

    await waitFor(() => expect(readTable().schema.mode).toBe('IDLE'));
    expect(readTable().schema.keys).toEqual(['p']);
    expect(readTable().file.mode).toBe('IDLE');
    expect(readTable().file.keys).toEqual(['p']);
  });

  it('a two-trait cascade fires even when only the emitter side carries a ledger eventId, and the cascade-fired sibling\'s own emit reaches the ambient bus exactly once', async () => {
    const { bus, host } = renderHost({ plugins: [cascadePlugin()] });
    const ackListener = vi.fn();
    bus.on('UI:ACK', ackListener);

    await waitFor(() => expect(host().getState('cascade', 'CascadeOrbital', 'Receiver')?.currentState).toBe('waiting'));

    bus.emit('UI:FIRE', {});

    await waitFor(() => expect(host().getState('cascade', 'CascadeOrbital', 'Receiver')?.currentState).toBe('received'));
    expect(host().errors.cascade).toBeUndefined();

    // `Receiver` never appears in `dispatch()`'s own response (it fires
    // through the runtime's internal cascade, not the directly-dispatched
    // `Emitter`) — its `ACK` emit reaching the ambient bus proves the
    // outbound path is the internal event bus, not the dispatch response.
    await waitFor(() => expect(ackListener).toHaveBeenCalledTimes(1));
    expect(ackListener.mock.calls[0][0].source?.trait).toBe('Receiver');
  });

  it('never re-broadcasts a relay event (its own inbound busEvent) — no infinite loop, sibling\'s PONG reaches the bus exactly once', async () => {
    const { bus, host, unmount } = renderHost({ plugins: [relayPlugin()] });
    const pongListener = vi.fn();
    bus.on('UI:PONG', pongListener);

    await waitFor(() => expect(host().getState('relay', 'RelayOrbital', 'A')?.currentState).toBe('idle'));

    // Circuit breaker: a regression here is a self-feeding async loop, not a
    // synchronous stack overflow (dispatch() awaits before re-emitting), so
    // a naive assertion after `bus.emit` would hang the whole run instead of
    // failing fast. Bound it: past a handful of re-broadcasts, tear the
    // plugin down (unsubscribes its `UI:PING` listener) so the loop cannot
    // continue, then let the (already-failing) count assertion below report
    // it plainly.
    let pingCount = 0;
    const MAX_PING = 5;
    bus.on('UI:PING', () => {
      pingCount += 1;
      if (pingCount > MAX_PING) unmount();
    });

    bus.emit('UI:PING', {});

    // The relay's own sibling cascade (A.PING -> B via the runtime's
    // internal event bus) is unaffected by the fix — B still transitions,
    // and B's own PONG emit — the whole point of the fix, this is exactly
    // the vim-mode `STATUS`/`REGISTER_COMMAND` shape — reaches the ambient
    // bus exactly once with `source.trait` = the sibling that fired it.
    await waitFor(() => expect(host().getState('relay', 'RelayOrbital', 'B')?.currentState).toBe('ponged'));
    await waitFor(() => expect(pongListener).toHaveBeenCalledTimes(1));
    expect(pongListener.mock.calls[0][0].source?.trait).toBe('B');
    // Let any wrongly-scheduled re-broadcast chain resolve before asserting.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(pingCount).toBe(1); // only our own manual emit — the host must never relay its own inbound vocabulary
    expect(pongListener).toHaveBeenCalledTimes(1); // still exactly once — no double-emit from response + onAny
    expect(host().errors.relay).toBeUndefined();
  });
});

describe('OrbitalPluginHost — slot cleanup by SOURCE (U-PLUGIN-SLOT-RESTORE-ON-UNMOUNT)', () => {
  function renderSidebarHost(opts: {
    plugins: PluginHostPlugin[];
    mode?: 'replace' | 'append';
    extraChildren?: React.ReactNode;
  }) {
    let bus!: EventBusContextType;
    function BusGrabber() {
      bus = useEventBus();
      return null;
    }
    const utils = render(
      <EventBusProvider isolated>
        <UISlotProvider>
          <OrbitalPluginHost plugins={opts.plugins}>
            <BusGrabber />
          </OrbitalPluginHost>
          <UISlotComponent slot="sidebar" mode={opts.mode ?? 'replace'} fallback={<div data-testid="stock" />} />
          {opts.extraChildren ?? null}
        </UISlotProvider>
      </EventBusProvider>,
    );
    return { bus, ...utils };
  }

  it('replace: fallback restores and the plugin\'s content is gone once the plugin is disabled', async () => {
    const { bus, rerender } = renderSidebarHost({ plugins: [sidebarPlugin()], mode: 'replace' });

    expect(screen.getByTestId('stock')).toBeInTheDocument();
    expect(screen.queryByText('plugin')).not.toBeInTheDocument();

    bus.emit('UI:PING', {});
    await waitFor(() => expect(screen.getByText('plugin')).toBeInTheDocument());
    expect(screen.queryByTestId('stock')).not.toBeInTheDocument();

    rerender(
      <EventBusProvider isolated>
        <UISlotProvider>
          <OrbitalPluginHost plugins={[]} />
          <UISlotComponent slot="sidebar" mode="replace" fallback={<div data-testid="stock" />} />
        </UISlotProvider>
      </EventBusProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('stock')).toBeInTheDocument());
    expect(screen.queryByText('plugin')).not.toBeInTheDocument();
  });

  it('append: stock + plugin content coexist, only stock remains once the plugin is disabled', async () => {
    const { bus, rerender } = renderSidebarHost({ plugins: [sidebarPlugin()], mode: 'append' });

    bus.emit('UI:PING', {});
    await waitFor(() => expect(screen.getByText('plugin')).toBeInTheDocument());
    expect(screen.getByTestId('stock')).toBeInTheDocument();

    rerender(
      <EventBusProvider isolated>
        <UISlotProvider>
          <OrbitalPluginHost plugins={[]} />
          <UISlotComponent slot="sidebar" mode="append" fallback={<div data-testid="stock" />} />
        </UISlotProvider>
      </EventBusProvider>,
    );

    await waitFor(() => expect(screen.queryByText('plugin')).not.toBeInTheDocument());
    expect(screen.getByTestId('stock')).toBeInTheDocument();
  });

  it('a render-ui with a null pattern clears only THIS plugin\'s source — another source in the same slot survives', async () => {
    const { bus } = renderSidebarHost({
      plugins: [sidebarPlugin()],
      mode: 'append',
      extraChildren: <OtherSourceSeeder />,
    });

    await waitFor(() => expect(screen.getByText('other')).toBeInTheDocument());

    bus.emit('UI:PING', {});
    await waitFor(() => expect(screen.getByText('plugin')).toBeInTheDocument());
    expect(screen.getByText('other')).toBeInTheDocument();

    bus.emit('UI:CLEAR', {});
    await waitFor(() => expect(screen.queryByText('plugin')).not.toBeInTheDocument());
    // The other source, never touched by this plugin's clear, survives.
    expect(screen.getByText('other')).toBeInTheDocument();
  });
});

/** A plugin whose `Clock` trait declares `ticks {}` emitting `BEAT`; `withTicks: false` is the same trait without them. */
function clockPlugin(withTicks: boolean): PluginHostPlugin {
  return {
    id: `clock-${withTicks ? 'ticking' : 'still'}`,
    schema: {
      name: 'clock-plugin',
      orbitals: [{
        name: 'ClockOrbital',
        entity: { name: 'ClockData', persistence: 'runtime', fields: [{ name: 'id', type: 'string' }] },
        pages: [],
        traits: [{
          name: 'Clock',
          scope: 'instance',
          linkedEntity: 'ClockData',
          stateMachine: { states: [{ name: 'idle', isInitial: true }], events: [], transitions: [] },
          emits: [{ event: 'BEAT', scope: 'external' }],
          ...(withTicks ? { ticks: [{ name: 'beat', interval: 30, effects: [['emit', 'BEAT', {}]] }] } : {}),
        }],
      }],
    },
    inbound: [],
  };
}

describe('OrbitalPluginHost — ticks run on the browser tick driver', () => {
  it('a mounted plugin declaring ticks {} ticks: its BEAT reaches the host bus, sourced from its orbital', async () => {
    const { bus } = renderHost({ plugins: [clockPlugin(true)] });
    const beat = vi.fn();
    bus.on('UI:BEAT', beat);
    await waitFor(() => expect(beat.mock.calls.length).toBeGreaterThan(1), { timeout: 5_000 });
    expect(beat.mock.calls[0][0].source?.orbital).toBe('ClockOrbital');
  });

  it('control: the same plugin without ticks {} never beats', async () => {
    const { bus, host } = renderHost({ plugins: [clockPlugin(false)] });
    const beat = vi.fn();
    bus.on('UI:BEAT', beat);
    await waitFor(() => expect(host().getState('clock-still', 'ClockOrbital', 'Clock')?.currentState).toBe('idle'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(beat).not.toHaveBeenCalled();
  });
});

/**
 * "Only mine" over the plugin's mock store: `LOAD` fetches every `Note`, and `MINE` reports how many are owned by
 * `owner` (`@user.id` for the dev viewer the seed stamped, or a literal id nobody holds for the control).
 */
function onlyMinePlugin(owner: string): PluginHostPlugin {
  return {
    id: `only-mine-${owner}`,
    schema: {
      name: 'only-mine-plugin',
      orbitals: [
        {
          name: 'People',
          entity: {
            name: 'Person', persistence: 'persistent', collection: 'people', identity: true,
            fields: [{ name: 'id', type: 'string', required: true }, { name: 'name', type: 'string' }, { name: 'role', type: 'string' }],
          },
          pages: [],
          traits: [],
        },
        {
          name: 'Notes',
          entity: {
            name: 'Note', persistence: 'persistent', collection: 'notes',
            fields: [{ name: 'id', type: 'string', required: true }, { name: 'title', type: 'string' }, { name: 'owner', type: 'relation', relation: { entity: 'Person' } }],
          },
          pages: [],
          traits: [{
            name: 'MyNotes',
            scope: 'collection',
            linkedEntity: 'Note',
            stateMachine: {
              states: [{ name: 'idle', isInitial: true }],
              events: [{ key: 'LOAD', name: 'LOAD' }, { key: 'LOADED', name: 'LOADED', payloadSchema: [{ name: 'data', type: 'array' }] }],
              transitions: [
                { from: 'idle', to: 'idle', event: 'LOAD', effects: [['fetch', 'Note', { emit: { success: 'LOADED' } }]] },
                {
                  from: 'idle',
                  to: 'idle',
                  event: 'LOADED',
                  effects: [['emit', 'MINE', { count: ['array/len', ['array/filter', '@payload.data', ['fn', 'r', ['==', '@r.owner', owner]]]] }]],
                },
              ],
            },
            emits: [{ event: 'MINE', scope: 'external' }],
            listens: [{ event: 'LOAD', triggers: 'LOAD' }],
          }],
        },
      ],
    },
    inbound: [{ busEvent: 'LOAD', orbital: 'Notes', trait: 'MyNotes', trigger: 'LOAD' }],
  };
}

describe('OrbitalPluginHost — the mock store is seeded for the dev viewer (seedMockStore)', () => {
  it('an "only mine" list of the dev viewer is not empty', async () => {
    const { bus } = renderHost({ plugins: [onlyMinePlugin('@user.id')] });
    const mine = vi.fn();
    bus.on('UI:MINE', mine);
    bus.emit('UI:LOAD', {});
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(mine.mock.calls[0][0].payload?.count).toBeGreaterThan(0);
  });

  it('control: the same list for a viewer the roster does not hold is empty', async () => {
    const { bus } = renderHost({ plugins: [onlyMinePlugin('not-a-persona')] });
    const mine = vi.fn();
    bus.on('UI:MINE', mine);
    bus.emit('UI:LOAD', {});
    await waitFor(() => expect(mine).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    expect(mine.mock.calls[0][0].payload?.count).toBe(0);
  });
});
