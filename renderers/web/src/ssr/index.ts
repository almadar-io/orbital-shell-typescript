/**
 * @almadar/ui/ssr
 *
 * SSR-safe subset of @almadar/ui for statically rendered sites (Docusaurus/webpack).
 * No game engines, no Three.js, no browser-only APIs at module scope.
 */

// Atoms















// Molecules
export { FeatureCard } from '../components/core/molecules/FeatureCard';
export type { FeatureCardProps } from '../components/core/molecules/FeatureCard';
export { FeatureGrid } from '../components/core/molecules/FeatureGrid';
export type { FeatureGridProps } from '../components/core/molecules/FeatureGrid';
export { SimpleGrid } from '../components/core/molecules/SimpleGrid';
export { Container } from '../components/core/molecules/Container';
export { StatDisplay } from '../components/core/molecules/StatDisplay';
export { GradientDivider } from '../components/core/molecules/GradientDivider';
export type { GradientDividerProps } from '../components/core/molecules/GradientDivider';
export { AnimatedCounter } from '../components/core/molecules/AnimatedCounter';
export type { AnimatedCounterProps } from '../components/core/molecules/AnimatedCounter';

// Scroll/trigger animation atoms (client-side, use inside BrowserOnly for SSR)





// Decorative patterns (pure SVG, SSR-safe)


export { GeometricPattern } from '../components/core/molecules/GeometricPattern';
export type { GeometricPatternProps } from '../components/core/molecules/GeometricPattern';
export { EdgeDecoration } from '../components/core/molecules/EdgeDecoration';
export type { EdgeDecorationProps, EdgeVariant, EdgeSide } from '../components/core/molecules/EdgeDecoration';
