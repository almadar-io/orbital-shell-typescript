'use client';
/**
 * BehaviorValueFrame — renders a whole behavior VALUE (`.lolo` type `behavior`,
 * `behavior/ref`) where a render tree embeds it: the host mounts the program
 * (validated at 0/0 and resolved), and the frame runs it in place through an
 * isolated `OrbPreview` — its own event bus, in-memory navigation starting at the
 * program's default page, the host URL untouched. A value carrying a `bridge` runs on
 * the host's bus instead (`OrbitalPluginHost`): the bridge's `listens` reach the traits
 * that handle them, its `emits` come back out, nothing else crosses.
 *
 * @packageDocumentation
 */

import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { BehaviorRef, MountedBehaviorValue } from '@almadar/core';
import { OrbPreview } from './OrbPreview';
import { MountedInit, TraitValueMountContext } from './TraitValueFrame';
import { OrbitalPluginHost } from './OrbitalPluginHost';
import { bridgeInbound } from './bridgeInbound';
import { UISlotProvider } from '../providers/UISlotContext';
import { UISlotComponent } from '../components/core/organisms/UISlotRenderer';
import { LoadingState } from '../components/core/molecules/LoadingState';
import { ErrorState } from '../components/core/molecules/ErrorState';

type FrameState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly mounted: MountedBehaviorValue }
  | { readonly status: 'error'; readonly message: string };

export function BehaviorValueFrame({ value }: { value: BehaviorRef }): React.ReactElement {
  const host = useContext(TraitValueMountContext);
  const key = useMemo(() => JSON.stringify(value), [value]);
  const latest = useRef(value);
  latest.current = value;
  const [state, setState] = useState<FrameState>({ status: 'loading' });

  useEffect(() => {
    const current = latest.current;
    const mountBehavior = host?.mountBehavior;
    if (mountBehavior === undefined) {
      setState({ status: 'error', message: `This host cannot run behavior ${current.behavior}` });
      return;
    }
    let live = true;
    setState({ status: 'loading' });
    void mountBehavior(current).then((result) => {
      if (!live) return;
      if (!result.ok) {
        const detail = (result.errors ?? []).map((e) => `${e.code}: ${e.message}`).join('\n');
        setState({ status: 'error', message: detail.length > 0 ? `${result.error}\n${detail}` : result.error });
        return;
      }
      setState({ status: 'ready', mounted: result.mounted });
    });
    return () => {
      live = false;
    };
  }, [host, key]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState message={state.message} />;
  if (value.bridge !== undefined) {
    const initEvent = `BEHAVIOR_VALUE_MOUNTED:${key}`;
    const plugin = {
      id: key,
      schema: state.mounted.schema,
      inbound: [...bridgeInbound(state.mounted.schema, value.bridge.listens), ...bridgeInbound(state.mounted.schema, ['INIT'], () => initEvent)],
      outbound: value.bridge.emits,
    };
    return (
      <UISlotProvider>
        <OrbitalPluginHost plugins={[plugin]} mode={host?.mode ?? 'mock'} transport={host?.transport}>
          <MountedInit event={initEvent} />
          <UISlotComponent slot="main" />
        </OrbitalPluginHost>
      </UISlotProvider>
    );
  }
  return (
    <OrbPreview
      schema={state.mounted.schema}
      initialPagePath={state.mounted.firstPage}
      isolated
      {...(host?.behaviorTransport !== undefined ? { transport: host.behaviorTransport } : {})}
    />
  );
}

export default BehaviorValueFrame;
