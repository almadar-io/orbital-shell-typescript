// Shared drawing contract + classification (lib/avl-theme); kinds come from @almadar/core / @almadar/std.
export type { AvlBaseProps, StateRole, EffectCategory } from '../../../lib/avl-theme';
export {
  STATE_COLORS,
  EFFECT_CATEGORY_COLORS,
  OPERATOR_CATEGORY_COLORS,
  CONNECTION_COLORS,
  getStateRole,
  effectCategoryOf,
} from '../../../lib/avl-theme';
export { FIELD_TYPE_SHAPES, type FieldTypeShape } from './AvlFieldType';

// Tier 1: Structural Primitives
export { AvlOrbital, type AvlOrbitalProps } from './AvlOrbital';
export { AvlEntity, type AvlEntityProps } from './AvlEntity';
export { AvlTrait, type AvlTraitProps } from './AvlTrait';
export { AvlPage, type AvlPageProps } from './AvlPage';
export { AvlApplication, type AvlApplicationProps } from './AvlApplication';

// Tier 2: Behavioral Primitives
export { AvlState, type AvlStateProps } from './AvlState';
export { AvlTransition, type AvlTransitionProps } from './AvlTransition';
export { AvlEvent, type AvlEventProps } from './AvlEvent';
export { AvlGuard, type AvlGuardProps } from './AvlGuard';
export { AvlEffect, type AvlEffectProps } from './AvlEffect';

// Tier 3: Data Primitives
export { AvlField, type AvlFieldProps } from './AvlField';
export { AvlFieldType, type AvlFieldTypeProps } from './AvlFieldType';
export { AvlBinding, type AvlBindingProps } from './AvlBinding';
export { AvlPersistence, type AvlPersistenceProps } from './AvlPersistence';

// Tier 4: Expression Primitives
export { AvlOperator, type AvlOperatorProps } from './AvlOperator';
export { AvlSExpr, type AvlSExprProps } from './AvlSExpr';
export { AvlLiteral, type AvlLiteralProps } from './AvlLiteral';
export { AvlBindingRef, type AvlBindingRefProps } from './AvlBindingRef';

// 3D Atoms (Three.js dependent - import via game/three barrel for SSR safety)
export { Avl3DLabel, type Avl3DLabelProps } from './Avl3DLabel';
export { Avl3DTooltip, type Avl3DTooltipProps } from './Avl3DTooltip';
