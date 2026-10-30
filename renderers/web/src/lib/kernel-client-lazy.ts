/**
 * The kernel client behind a dynamic import: the adapter code is fetched only when a circuit runs the
 * kernel engine, so a host on the default `'js'` engine ships none of it. Calls made before the chunk
 * arrives are held and replayed in call order.
 *
 * @packageDocumentation
 */
import type { KernelClient, KernelClientOptions } from './kernel-client';

export function createLazyKernelClient(opts: KernelClientOptions): KernelClient {
  let loaded: KernelClient | undefined;
  const client = import('./kernel-client').then((m) => (loaded = m.createKernelClient(opts)));
  client.catch(() => undefined);
  return {
    store: opts.store,
    dispatch: (request, hooks) => client.then((c) => c.dispatch(request, hooks)),
    dispatchProgress: (request) => client.then((c) => c.dispatchProgress(request)),
    foldHostDispatch: (request, response) => client.then((c) => c.foldHostDispatch(request, response)),
    deliverEmit: (emitted) => client.then((c) => c.deliverEmit(emitted)),
    deliverToListeners: (emitted) => client.then((c) => c.deliverToListeners(emitted)),
    deliverOriginEmit: (emitted) => client.then((c) => c.deliverOriginEmit(emitted)),
    dispatchMount: (seeds, hooks, base) => client.then((c) => c.dispatchMount(seeds, hooks, base)),
    routeMounts: (routePath) => client.then((c) => c.routeMounts(routePath)),
    enter: (routePath, mountKey, traits) => client.then((c) => c.enter(routePath, mountKey, traits)),
    leave: () => client.then((c) => c.leave()),
    frame: (nowMs) => client.then((c) => c.frame(nowMs)),
    startFrames: (onFrame, schedule) => {
      let stop: (() => void) | undefined;
      let stopped = false;
      void client.then((c) => { if (!stopped) stop = c.startFrames(onFrame, schedule); });
      return () => { stopped = true; stop?.(); };
    },
    framePause: () => loaded?.framePause(),
    frameResume: () => loaded?.frameResume(),
    traitState: (traitName) => loaded?.traitState(traitName),
    traitConfig: (traitName) => loaded?.traitConfig(traitName),
    setViewer: (user) => client.then((c) => c.setViewer(user)),
  };
}
