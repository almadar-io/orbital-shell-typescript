/**
 * AVL-aligned color palette for Orb and Lolo syntax highlighting.
 *
 * Shared semantic tokens (binding, effect, event, …) carry the same color
 * in both .orb and .lolo so the same concept is always the same hue.
 *
 * LOLO adds four tokens that have no .orb equivalent:
 *   loloKeyword     — declaration keywords (orbital, entity, trait, state …)
 *   loloConstructor — PascalCase names (entity/trait/orbital identifiers)
 *   loloArrow       — transition and type arrows (`->`, `→`)
 *   loloReference   — qualified dotted paths (Modal.traits.X)
 *
 * Color rationale (Haskell-influenced adaptation):
 *   loloKeyword     steel blue  — Haskell keyword colour in VS Code dark+
 *   loloConstructor teal        — Haskell type/constructor colour
 *   loloArrow       soft pink   — Haskell function-arrow colour (`->`)
 *   loloReference   light blue  — Haskell qualified-module prefix colour
 */

/** The surfaces a code block draws its tokens on: the light block, the cream page card and the highlighted-line tint, and the dark block. Every token colour holds WCAG AA on each of its scheme's surfaces. */
export const CODE_SURFACES = {
  light: ['#FFFFFF', '#FBF8EE', '#DFE9F0'],
  dark: ['#1E1E1E'],
} as const;

export const ORB_COLORS = {
  dark: {
    // ── Shared: .orb and .lolo ──────────────────────────────────────────────
    binding:        '#22D3EE',  // cyan  - AvlBindingRef  (@field, ?field)
    effect:         '#A78BFA',  // violet - AvlEffect      (set persist emit …)
    arithmetic:     '#4A90D9',  // blue  - AVL arithmetic
    comparison:     '#E8913A',  // orange - AVL comparison
    logic:          '#A970C0',  // purple - AVL logic
    control:        '#E85243',  // red   - AVL control
    string:         '#27AE60',  // green - AVL string ops
    collection:     '#1ABC9C',  // teal  - AVL collection
    time:           '#F39C12',  // amber - AVL time
    async:          '#EC3C9E',  // pink  - AVL async
    event:          '#FBBF24',  // yellow - AvlEvent      (UPPER_SNAKE)
    pattern:        '#F472B6',  // pink  - UI pattern name
    patternWarning: '#F59E0B',  // amber - unregistered pattern
    error:          '#EF4949',  // red   - unknown/invalid operator
    structural:     '#9CA3AF',  // gray  - .orb schema keys
    stringLiteral:  '#4ADE80',  // green - AvlLiteral
    number:         '#60A5FA',  // blue  - AvlLiteral
    boolean:        '#C084FC',  // purple
    null:           '#7F8694',  // gray
    uiSlot:         '#2DD4BF',  // teal  - AvlSlotMap
    fieldType:      '#E8913A',  // orange - AvlFieldType
    persistence:    '#E8913A',  // orange - Entity stroke
    behavior:       '#818CF8',  // indigo - std behavior name

    // ── LOLO-specific ───────────────────────────────────────────────────────
    loloKeyword:     '#569CD6',  // steel blue  - declaration keywords
    loloConstructor: '#4EC9B0',  // teal        - PascalCase names
    loloArrow:       '#C586C0',  // soft pink   - `->` / `→`
    loloReference:   '#79B8FF',  // light blue  - Modal.traits.X paths
  },
  light: {
    // ── Shared ──────────────────────────────────────────────────────────────
    binding:        '#06718B',
    effect:         '#7C3AED',
    arithmetic:     '#1C5CEA',
    comparison:     '#9D5604',
    logic:          '#7C3AED',
    control:        '#CA2121',
    string:         '#047653',
    collection:     '#0A736A',
    time:           '#9D5604',
    async:          '#C32069',
    event:          '#A84D08',
    pattern:        '#C32069',
    patternWarning: '#9D5604',
    error:          '#CA2121',
    structural:     '#626875',
    stringLiteral:  '#047653',
    number:         '#1C5CEA',
    boolean:        '#7C3AED',
    null:           '#626875',
    uiSlot:         '#0A736A',
    fieldType:      '#9D5604',
    persistence:    '#9D5604',
    behavior:       '#4F46E5',

    // ── LOLO-specific ───────────────────────────────────────────────────────
    loloKeyword:     '#0000FF',  // VS Code light keyword blue
    loloConstructor: '#217087',  // VS Code light type teal
    loloArrow:       '#AD00D8',  // VS Code light function arrow purple
    loloReference:   '#001080',  // VS Code light module reference
  },
} as const;
