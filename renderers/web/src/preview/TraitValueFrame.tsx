'use client';
/**
 * TraitValueFrame — renders a trait VALUE (a trait of an installed behavior held
 * as data, language trio) where a render tree embeds it, the data-bound sibling
 * of `TraitFrame`'s `@trait.X` lens.
 *
 * The host turns the value into a runnable program (`TraitValueMountProvider`'s
 * `mount`: a validated, resolved one-orbital wrapper — the binding's admission
 * check), and the frame runs it through the plugin host's own runtime, bridged
 * to the ambient event bus, inside a scoped slot provider so the trait's UI
 * paints HERE rather than into the app's shared slots. The plugin host mounts
 * what the wrapper program declares (its route pages), so the frame sends no `INIT`.
 *
 * @packageDocumentation
 */

import React, { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BehaviorRef, BehaviorValueMountResult, TraitValue, TraitValueMountResult } from '@almadar/core';
import type { EventTransport } from '../index';
import type { ServerBridgeTransport } from '../providers/ServerBridge';
import { UISlotProvider } from '../providers/UISlotContext';
import { OrbitalPluginHost, type PluginHostPlugin } from './OrbitalPluginHost';
import { UISlotComponent } from '../components/core/organisms/UISlotRenderer';
import { LoadingState } from '../components/core/molecules/LoadingState';
import { ErrorState } from '../components/core/molecules/ErrorState';

/** How the host mounts trait values: the resolver plus the plugin-host execution mode. */
export interface TraitValueMountHost {
  mount: (value: TraitValue) => Promise<TraitValueMountResult>;
  /** 'mock' (default): in-memory, as a preview. 'server': through `transport`. */
  mode?: 'mock' | 'server';
  transport?: EventTransport;
  /** Mounts a whole behavior value (`BehaviorValueFrame`); a host without it cannot run behavior values. */
  mountBehavior?: (value: BehaviorRef) => Promise<BehaviorValueMountResult>;
  /** Where a mounted behavior value's events run; in-memory when omitted. */
  behaviorTransport?: ServerBridgeTransport;
}

export const TraitValueMountContext = createContext<TraitValueMountHost | null>(null);

export function TraitValueMountProvider({ host, children }: { host: TraitValueMountHost; children: ReactNode }): React.ReactElement {
  return <TraitValueMountContext.Provider value={host}>{children}</TraitValueMountContext.Provider>;
}

type FrameState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly plugin: PluginHostPlugin }
  | { readonly status: 'error'; readonly message: string };

export function TraitValueFrame({ value }: { value: TraitValue }): React.ReactElement {
  const host = useContext(TraitValueMountContext);
  const key = useMemo(() => JSON.stringify(value), [value]);
  const latest = useRef(value);
  latest.current = value;
  const [state, setState] = useState<FrameState>({ status: 'loading' });

  useEffect(() => {
    const current = latest.current;
    if (host === null) {
      setState({ status: 'error', message: `No trait-value host is configured to mount ${current.behavior}.traits.${current.trait}` });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    void host.mount(current).then((result) => {
      if (!live) return;
      if (!result.ok) {
        const detail = (result.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('\n');
        setState({ status: 'error', message: detail.length > 0 ? `${result.error}\n${detail}` : result.error });
        return;
      }
      setState({ status: 'ready', plugin: { id: key, schema: result.mounted.schema, inbound: [] } });
    });
    return () => {
      live = false;
    };
  }, [host, key]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState message={state.message} />;
  return (
    <UISlotProvider>
      <OrbitalPluginHost plugins={[state.plugin]} mode={host?.mode ?? 'mock'} transport={host?.transport}>
        <UISlotComponent slot="main" />
      </OrbitalPluginHost>
    </UISlotProvider>
  );
}

export default TraitValueFrame;
