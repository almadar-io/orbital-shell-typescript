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
import type { BehaviorRef, BehaviorValueMountResult, MountedBehaviorValue, RuntimeValue } from '@almadar/core';
import { OrbitalSchemaSchema, defaultPage } from '@almadar/core';
import { OrbPreview } from './OrbPreview';
import { TraitValueMountContext } from './TraitValueFrame';
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

/** A value carrying its resolved program runs it as it is: parsed against the program schema, opened on its default page. */
function mountCarried(behavior: string, resolved: string): BehaviorValueMountResult {
  let json: RuntimeValue;
  try {
    json = JSON.parse(resolved);
  } catch (error) {
    return { ok: false, error: `behavior ${behavior}: its resolved program is not JSON: ${String(error)}` };
  }
  const parsed = OrbitalSchemaSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: `behavior ${behavior}: its resolved program is not a program: ${parsed.error.message}` };
  const first = defaultPage(parsed.data)?.page.path;
  if (first === undefined) return { ok: false, error: `behavior ${behavior} has no page to open` };
  return { ok: true, mounted: { schema: parsed.data, firstPage: first } };
}

export function BehaviorValueFrame({ value }: { value: BehaviorRef }): React.ReactElement {
  const host = useContext(TraitValueMountContext);
  const key = useMemo(() => JSON.stringify(value), [value]);
  const latest = useRef(value);
  latest.current = value;
  const [state, setState] = useState<FrameState>({ status: 'loading' });

  useEffect(() => {
    const current = latest.current;
    if (current.resolved !== undefined) {
      const carried = mountCarried(current.behavior, current.resolved);
      setState(carried.ok ? { status: 'ready', mounted: carried.mounted } : { status: 'error', message: carried.error });
      return;
    }
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
    const plugin = {
      id: key,
      schema: state.mounted.schema,
      inbound: bridgeInbound(state.mounted.schema, value.bridge.listens),
      outbound: value.bridge.emits,
    };
    return (
      <UISlotProvider>
        <OrbitalPluginHost plugins={[plugin]} mode={host?.mode ?? 'mock'} transport={host?.transport}>
          <UISlotComponent slot="main" />
        </OrbitalPluginHost>
      </UISlotProvider>
    );
  }
  return (
    <OrbPreview
      schema={state.mounted.schema}
      initialPagePath={state.mounted.firstPage}
      height="100%"
      isolated
      {...(host?.behaviorTransport !== undefined ? { transport: host.behaviorTransport } : {})}
    />
  );
}

export default BehaviorValueFrame;
