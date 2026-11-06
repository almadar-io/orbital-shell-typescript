/**
 * The 3D scene props a pattern declares as data (light rig, post-processing stack), shared by the `canvas` and
 * learning patterns and drawn by orbital-canvas.
 *
 * @packageDocumentation
 */

/** Single light's tunable knobs (ambient/directional share this shape). */
export type CanvasLightConfig = {
    intensity?: number;
    color?: string;
    position?: [number, number, number];
};

/** Hemisphere (sky/ground) light config. */
export type CanvasHemisphereConfig = {
    intensity?: number;
    color?: string;
    groundColor?: string;
};

/** Point light config — `position` is required since a point light has no meaningful default placement. */
export type CanvasPointLightConfig = {
    intensity?: number;
    color?: string;
    position: [number, number, number];
    distance?: number;
    decay?: number;
};

/** Canvas-level 3D light rig, authored as data. Every field is optional; an omitted field takes the standard rig's value. */
export type CanvasLighting = {
    /** Default intensity 0.6, color '#ffffff'. */
    ambient?: CanvasLightConfig;
    /** Default intensity 0.8, color '#ffffff', position [10, 20, 10]. */
    directional?: CanvasLightConfig;
    /** Default intensity 0.3, color '#87ceeb', groundColor '#362d1d'. */
    hemisphere?: CanvasHemisphereConfig;
    /** Additional point lights. Default none. */
    points?: CanvasPointLightConfig[];
    /** Procedural environment for PBR reflection (metals/glass). Default 'none'. */
    environment?: 'room' | 'none';
    /** Output tone mapping. Default 'aces' (filmic); 'none' renders material colors faithfully. */
    toneMapping?: 'aces' | 'none';
};

/** Canvas-level post-processing stack. Every field is optional; an omitted field means that pass is not run. */
export type CanvasPost = {
    bloom?: { intensity?: number; threshold?: number; smoothing?: number };
    vignette?: { offset?: number; darkness?: number };
};
