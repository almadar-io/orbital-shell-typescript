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

export const ORB_COLORS = {
  dark: {
    // ── Shared: .orb and .lolo ──────────────────────────────────────────────
    binding:        '#22D3EE',  // cyan  - AvlBindingRef  (@field, ?field)
    effect:         '#A78BFA',  // violet - AvlEffect      (set persist emit …)
    arithmetic:     '#4A90D9',  // blue  - AVL arithmetic
    comparison:     '#E8913A',  // orange - AVL comparison
    logic:          '#9B59B6',  // purple - AVL logic
    control:        '#E74C3C',  // red   - AVL control
    string:         '#27AE60',  // green - AVL string ops
    collection:     '#1ABC9C',  // teal  - AVL collection
    time:           '#F39C12',  // amber - AVL time
    async:          '#E91E8F',  // pink  - AVL async
    event:          '#FBBF24',  // yellow - AvlEvent      (UPPER_SNAKE)
    pattern:        '#F472B6',  // pink  - UI pattern name
    patternWarning: '#F59E0B',  // amber - unregistered pattern
    error:          '#EF4444',  // red   - unknown/invalid operator
    structural:     '#9CA3AF',  // gray  - .orb schema keys
    stringLiteral:  '#4ADE80',  // green - AvlLiteral
    number:         '#60A5FA',  // blue  - AvlLiteral
    boolean:        '#C084FC',  // purple
    null:           '#6B7280',  // gray
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
    binding:        '#0891B2',
    effect:         '#7C3AED',
    arithmetic:     '#2563EB',
    comparison:     '#D97706',
    logic:          '#7C3AED',
    control:        '#DC2626',
    string:         '#059669',
    collection:     '#0D9488',
    time:           '#D97706',
    async:          '#DB2777',
    event:          '#B45309',
    pattern:        '#DB2777',
    patternWarning: '#D97706',
    error:          '#DC2626',
    structural:     '#6B7280',
    stringLiteral:  '#059669',
    number:         '#2563EB',
    boolean:        '#7C3AED',
    null:           '#6B7280',
    uiSlot:         '#0D9488',
    fieldType:      '#D97706',
    persistence:    '#D97706',
    behavior:       '#4F46E5',

    // ── LOLO-specific ───────────────────────────────────────────────────────
    loloKeyword:     '#0000FF',  // VS Code light keyword blue
    loloConstructor: '#267F99',  // VS Code light type teal
    loloArrow:       '#AF00DB',  // VS Code light function arrow purple
    loloReference:   '#001080',  // VS Code light module reference
  },
} as const;
