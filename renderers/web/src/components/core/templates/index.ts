// Base Types
export type { TemplateProps } from './types';

// Layout Templates
export { DashboardLayout, type DashboardLayoutProps, type NavItem } from './DashboardLayout';
export { AuthLayout, type AuthLayoutProps } from './AuthLayout';

// Feature Templates
export {
  CounterTemplate,
  type CounterTemplateProps,
  type CounterSize,
  type CounterVariant
} from './CounterTemplate';

export {
  GenericAppTemplate,
  type GenericAppTemplateProps
} from './GenericAppTemplate';

export {
  GameShell,
  type GameShellProps
} from '../../game/templates/GameShell';

// Game-genre view templates removed — boards are now .lolo game-shell compositions, not React components.

// The 3D draw-host is three.js-backed and intentionally NOT exported here — it
// ships code-split behind the optional `@almadar/shell-web/three` subpath, whose
// source lives in `lib/drawable/three/` (the 3D painter backend of the drawable
// substrate). No shadow export is needed.
