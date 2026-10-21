export type { PhysicsPreset, PhysicsBody, PhysicsConstraint } from './physicsTypes';
export { projectileMotion, pendulum, springOscillator } from './mechanics';

import { projectileMotion, pendulum, springOscillator } from './mechanics';
import type { PhysicsPreset } from './physicsTypes';

export const ALL_PRESETS: PhysicsPreset[] = [
    projectileMotion,
    pendulum,
    springOscillator,
];
