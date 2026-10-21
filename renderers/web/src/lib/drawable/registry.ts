/**
 * Drawable registration context — lets `draw-*` atoms composed as React children
 * inside a draw-host (Canvas2D) register their descriptor for painting.
 *
 * When a canvas authors its drawables as declarative JSX children (`<DrawShape .../>`)
 * instead of a `drawables` data prop, each child registers here during render.
 * The host reads the collected array in its post-render effect and paints it.
 *
 * Render-phase registration is safe: the host clears the ref at the top of each
 * render pass, children push synchronously during the same pass, and the host
 * reads the ref in `useEffect` (after React commits the full subtree).
 */
import { createContext } from 'react';
import type { DrawableNode } from './paintDispatch';

export type DrawableRegistrar = (node: DrawableNode) => void;

export const DrawableRegistryContext = createContext<DrawableRegistrar | null>(null);
