/**
 * @almadar/ui Tailwind Preset
 *
 * Provides the complete Almadar design token system as a Tailwind preset.
 * Includes a safelist for CSS-variable-based arbitrary classes that use
 * bracket notation (Tailwind can't extract these from source scanning).
 *
 * Note: @almadar/ui dist content scanning is handled by tailwind.config.js
 * in the shell template, not here. The config resolves the dist path via
 * require.resolve('./src/components') which works regardless of hoisting.
 *
 * Usage in tailwind.config.js:
 *   presets: [require('@almadar/shell-web/tailwind-preset')]
 */

// The one definition of the container breakpoints and the modal min widths; the native shells read the same file.
const nativeTokens = require('./src/core/tokens/native-tokens.json');

// Tailwind can only apply an opacity modifier (`bg-primary/50`) to a color it
// can compute alpha for itself — a bare `var(--color-x)` string is opaque to
// it, so every semantic token below must resolve through this function or its
// `/NN` utilities silently generate no CSS rule at all (not even with the
// class safelisted — confirmed via a standalone `tailwindcss` CLI build).
function withOpacity(varName) {
  return ({ opacityValue }) =>
    opacityValue === undefined
      ? `var(${varName})`
      : `color-mix(in srgb, var(${varName}) calc(${opacityValue} * 100%), transparent)`;
}

// The class vocabulary visual editors write onto `className` (@almadar/core
// `design-classes`, in this package). Safelisted whole so any class an editor picks compiles.
const { allDesignClasses } = require('./dist/design-classes/index.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  safelist: [
  'proof-marquee', 'proof-marquee-track', 'animate-almadar-marquee',
  'hover:[animation-play-state:paused]', 'motion-reduce:animate-none', 'motion-reduce:w-auto',
  'motion-reduce:flex-wrap', 'motion-reduce:justify-center', 'motion-reduce:hidden', 'motion-reduce:[mask-image:none]',
  ...allDesignClasses(),
  // Standard utilities used via dynamic className from .orb schemas
  'contents',
  'p-4', 'p-6', 'p-8',
  'px-4', 'px-6', 'py-4', 'py-6',
  'mx-auto',
  'w-full',
  'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl', 'max-w-3xl', 'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-7xl',
  'min-h-screen',
  'gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-6', 'gap-8',
  'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4',
  'sm:grid-cols-2', 'md:grid-cols-2', 'md:grid-cols-3', 'lg:grid-cols-3', 'lg:grid-cols-4',
  'text-center', 'text-left', 'text-right',
  // Split composes its stacking classes as `${containerBreakpoint}${cls}` at runtime
  ...['@sm:', '@md:', '@lg:', '@xl:'].flatMap((bp) => [
    'w-1/2', 'w-1/3', 'w-2/3', 'w-1/4', 'w-3/4', 'w-1/5', 'w-4/5', 'w-2/5', 'w-3/5', 'flex-row', 'flex-row-reverse',
  ].map((cls) => `${bp}${cls}`)),
  // Container-query layout a .lolo body composes (a behavior sized by the room it is given)
  ...['@sm:', '@md:'].flatMap((bp) => ['block', 'hidden', 'flex', 'flex-row', 'w-16', 'basis-auto', 'text-base', 'text-xl', 'text-2xl', 'text-3xl'].map((cls) => `${bp}${cls}`)),
  // Flex shares a .lolo composes from knobs (e.g. a split whose hovered panel grows)
  ...['', '@sm:', '@md:', '@lg:', '@xl:'].flatMap((bp) => ['', 'hover:', 'focus-within:'].flatMap((state) =>
    ['w-auto', 'basis-0', 'grow', 'grow-0', ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map((n) => `grow-[${n}]`)]
      .map((cls) => `${bp}${state}${cls}`))),
  'basis-full', 'min-w-0', 'transition-[flex-grow]', 'duration-500', 'ease-out', 'motion-reduce:transition-none',
  // Non-theme CSS variable classes (no semantic equivalent in theme config)
  'active:scale-[var(--active-scale)]',
  'border-b-[length:var(--border-width)]',
  'border-[length:var(--border-width)]',
  'border-[length:var(--border-width-thin)]',
  'border-l-[length:var(--border-width)]',
  'border-r-[length:var(--border-width)]',
  'border-t-[length:var(--border-width)]',
  'border-x-[length:var(--border-width)]',
  'duration-[var(--transition-fast)]',
  'duration-[var(--transition-normal)]',
  'focus:ring-[length:var(--focus-ring-width)]',
  'focus:ring-offset-[length:var(--focus-ring-offset)]',
  'text-[var(--icon-color,currentColor)]',
  'placeholder:text-[var(--color-placeholder)]',
  // Table-specific tokens
  'bg-[var(--color-table-header)]',
  'border-[var(--color-table-border)]',
  'hover:bg-[var(--color-table-row-hover)]',
  'hover:bg-[var(--color-surface-hover)]',
  'hover:border-[var(--color-border-hover)]',
  'hover:border-l-[var(--color-muted)]',
  // Gradient partials with opacity
  // Opacity variants on semantic colors (used in components)
  'bg-primary/10', 'bg-accent/10',
  'bg-muted/20', 'bg-muted/30', 'bg-muted/50', 'bg-muted/60',
  'bg-surface/60', 'bg-surface/80',
  'bg-background/10', 'bg-background/80',
  'bg-card/80', 'bg-foreground/0', 'bg-foreground/50',
  'bg-error/10', 'bg-info/10', 'bg-success/10', 'bg-warning/10',
  'border-accent/30', 'border-border/40',
  'border-error/30', 'border-error/50',
  'border-info/30', 'border-success/30', 'border-warning/30',
  'ring-accent/20', 'ring-error/20', 'ring-info/20',
  'ring-muted-foreground/20', 'ring-primary/30',
  'ring-success/20', 'ring-warning/20',
  'text-foreground/30', 'text-foreground/60',
  'text-muted-foreground/50',
  'hover:bg-error/10', 'hover:bg-muted/50', 'hover:bg-muted/80',
  'hover:bg-muted-foreground/15', 'hover:bg-primary/10',
  'dark:bg-foreground/70', 'dark:hover:bg-error/20',
  'group-hover:bg-foreground/20', 'group-hover:text-primary',
  'peer-focus:ring-error/20', 'peer-focus:ring-ring/20',
  // Hover elevation & micro-interactions
  'hover:-translate-y-0.5',
  'hover:-translate-y-1',
  'hover:scale-105',
  'scale-[1.05]',
  'transition-all',
  'duration-200',
  'ring-2',
  'ring-primary',
  
  // Motion utilities (applied conditionally on open/close state)
  'animate-modal-in',
  'animate-modal-out',
  'animate-overlay-in',
  'animate-overlay-out',
  'animate-slide-up',
  'animate-drawer-in',
  'animate-drawer-out',
  'animate-popover-in',
  'animate-popover-out',
  'animate-toast-in',
  'animate-toast-out',
  'animate-fade-in',
  'animate-fade-out',
  'animate-page-in',
  'animate-page-out',
  'animate-shimmer',
  
  // Auto-added by audit-tailwind-safelist.ts (2026-03-28)
  'active:scale-[var(--active-scale)]',
  'animate-[combat-flash_0.2s_ease-in-out_2]',
  'animate-[combat-heal-glow_0.8s_ease-in-out]',
  'animate-[combat-pulse-red_0.5s_ease-in-out]',
  'animate-[combat-shake_0.3s_ease-in-out]',
  'animate-[shake_0.3s_ease-in-out]',
  'aspect-[3/4]',
  'bg-[radial-gradient(circle_at_center,rgba(34,197,94,0.2),transparent_70%)]',
  'bg-[radial-gradient(ellipse_at_top,var(--color-primary)/0.08,transparent_60%),radial-gradient(ellipse_at_bottom_right,var(--color-accent)/0.06,transparent_50%)]',
  'bg-[var(--color-background)]',
  'bg-[var(--color-card)]',
  'bg-[var(--color-table-header)]',
  'bg-accent/10',
  'bg-accent/20',
  'bg-background/80',
  'bg-card/80',
  'bg-error/10',
  'bg-foreground/0',
  'bg-foreground/50',
  'bg-info/10',
  'bg-muted/20',
  'bg-muted/30',
  'bg-muted/50',
  'bg-muted/60',
  'bg-primary/10',
  'bg-primary/20',
  'bg-success/10',
  'bg-success/20',
  'bg-surface/60',
  'bg-surface/80',
  'bg-warning/10',
  'border-[length:2px]',
  'border-[length:var(--border-width-thin)]',
  'border-[length:var(--border-width)]',
  'border-[var(--color-border)]',
  'border-[var(--color-table-border)]',
  'border-accent/30',
  'border-b-[length:var(--border-width)]',
  'border-border/40',
  'border-error/30',
  'border-error/50',
  'border-info/30',
  'border-l-[3px]',
  'border-l-[length:var(--border-width)]',
  'border-primary/30',
  'border-r-[length:var(--border-width)]',
  'border-success/30',
  'border-t-[length:var(--border-width)]',
  'border-warning/30',
  'border-x-[length:var(--border-width)]',
  'dark:bg-foreground/70',
  'dark:hover:bg-error/20',
  'duration-[var(--transition-fast)]',
  'duration-[var(--transition-normal)]',
  'focus:ring-[length:var(--focus-ring-width)]',
  'focus:ring-offset-[length:var(--focus-ring-offset)]',
  'from-[var(--color-primary)]',
  'group-hover:bg-foreground/20',
  'h-[18px]',
  'h-[1em]',
  'h-[80px]',
  'hover:bg-[var(--color-card)]',
  'hover:bg-[var(--color-surface-hover)]',
  'hover:bg-[var(--color-table-row-hover)]',
  'hover:bg-error/10',
  'hover:bg-error/80',
  'hover:bg-muted/50',
  'hover:bg-muted/80',
  'hover:bg-primary/10',
  'hover:border-[var(--color-border-hover)]',
  'hover:border-l-[var(--color-muted)]',
  'left-[-5px]',
  'lg:max-w-[50%]',
  'lg:min-w-[45%]',
  'max-h-[1000px]',
  'max-h-[280px]',
  'max-h-[500px]',
  'max-h-[80vh]',
  'max-w-[120px]',
  'max-w-[160px]',
  'max-w-[180px]',
  'max-w-[200px]',
  'max-w-[280px]',
  'max-w-[300px]',
  'max-w-[400px]',
  'max-w-[60%]',
  'max-w-[75%]',
  'max-w-[80%]',
  'min-h-[200px]',
  'min-h-[240px]',
  'min-h-[24px]',
  'min-h-[2rem]',
  'min-h-[400px]',
  'min-h-[44px]',
  'min-h-[4px]',
  'min-h-[600px]',
  'min-h-[60px]',
  'min-h-[60vh]',
  'min-h-[80px]',
  'min-h-[80vh]',
  'min-h-[85vh]',
  'min-w-[100px]',
  'min-w-[120px]',
  'min-w-[130px]',
  'min-w-[140px]',
  'min-w-[160px]',
  'min-w-[18px]',
  'min-w-[2.5rem]',
  'min-w-[200px]',
  'min-w-[20px]',
  'min-w-[2rem]',
  'min-w-[300px]',
  'min-w-[3ch]',
  'min-w-[3rem]',
  'min-w-[40px]',
  'min-w-[44px]',
  'min-w-[60px]',
  'min-w-[65px]',
  'min-w-[800px]',
  'min-w-[80px]',
  'ml-[1px]',
  'ml-[calc(1.5rem)]',
  'peer-focus:ring-error/20',
  'peer-focus:ring-ring/20',
  'placeholder:text-[var(--color-placeholder)]',
  'ring-accent/20',
  'ring-accent/50',
  'ring-error/20',
  'ring-info/20',
  'ring-muted-foreground/20',
  'ring-primary/30',
  'ring-success/20',
  'ring-warning/20',
  'rounded-[var(--radius-md)]',
  'scale-[1.05]',
  'shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.05)]',
  'shadow-[0_0_10px_rgba(251,191,36,0.5)]',
  'shadow-[0_0_6px_rgba(59,130,246,0.3)]',
  'shadow-[0_0_8px_rgba(168,85,247,0.4)]',
  'text-[0.65rem]',
  'text-[9px]',
  'text-[var(--color-foreground)]',
  'text-[var(--color-muted-foreground)]',
  'text-[var(--icon-color,currentColor)]',
  'text-foreground/30',
  'text-foreground/60',
  'text-foreground/70',
  'text-foreground/80',
  'text-muted-foreground/50',
  'to-[var(--color-secondary)]',
  'w-[280px]',
  'w-[2px]',
  'w-[480px]',
  'w-[640px]',
  'will-change-[opacity,transform]',
  'z-[1000]',
  'z-[1001]',
  'z-[60]',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-19)
  'bg-[var(--color-border)]',
  'bg-[var(--color-muted)]',
  'bg-[var(--color-primary)]',
  'bg-[var(--color-surface-subtle)]',
  'bg-[var(--color-surface)]',
  'bg-[var(--color-warning)]',
  'bg-accent/15',
  'bg-background/60',
  'bg-background/95',
  'bg-card/40',
  'bg-card/50',
  'bg-card/90',
  'bg-card/95',
  'bg-error/15',
  'bg-error/70',
  'bg-error/80',
  'bg-foreground/40',
  'bg-muted-foreground/50',
  'bg-muted/10',
  'bg-muted/40',
  'bg-primary/15',
  'bg-primary/80',
  'bg-secondary/10',
  'bg-success/15',
  'bg-success/80',
  'bg-warning/15',
  'bg-warning/80',
  'border-[length:var(--border-width-thick)]',
  'border-[var(--color-primary)]',
  'border-[var(--color-warning)]',
  'border-border/10',
  'border-border/20',
  'border-border/50',
  'border-error/40',
  'border-error/70',
  'border-info/70',
  'border-l-[length:var(--border-width-thin)]',
  'border-primary/20',
  'border-primary/40',
  'border-success/40',
  'border-success/50',
  'border-success/70',
  'border-warning/40',
  'border-warning/60',
  'border-y-[length:var(--border-width)]',
  'bottom-[15%]',
  'focus-visible:ring-[length:var(--focus-ring-width)]',
  'focus-visible:ring-offset-[length:var(--focus-ring-offset)]',
  'focus-within:border-[var(--color-primary)]',
  'from-primary/90',
  'group-hover:bg-[var(--color-surface-subtle)]',
  'h-[1.25rem]',
  'h-[1.5rem]',
  'hover:bg-[var(--color-card-hover,transparent)]',
  'hover:bg-[var(--color-muted)]',
  'hover:bg-[var(--color-surface-subtle)]',
  'hover:bg-[var(--color-surface)]',
  'hover:bg-foreground/10',
  'hover:bg-muted-foreground/70',
  'hover:bg-muted/30',
  'hover:bg-muted/40',
  'hover:bg-primary-foreground/15',
  'hover:bg-primary-foreground/20',
  'hover:text-[var(--color-foreground)]',
  'hover:text-info/80',
  'hover:translate-y-[var(--hover-translate-y)]',
  'left-[15%]',
  'max-h-[36rem]',
  'max-h-[60vh]',
  'max-w-[calc(100vw-1.5rem)]',
  'max-w-[calc(100vw-1rem)]',
  'max-w-[calc(100vw-2rem)]',
  'md:grid-cols-[var(--master-detail-cols)]',
  'md:max-w-[50%]',
  'md:min-w-[160px]',
  'md:min-w-[45%]',
  'min-h-[16rem]',
  'min-h-[3rem]',
  'min-h-[8rem]',
  'min-w-[10rem]',
  'min-w-[16rem]',
  'min-w-[2px]',
  'min-w-[400px]',
  'min-w-[520px]',
  'min-w-[600px]',
  'min-w-[700px]',
  'min-w-[8rem]',
  'pt-[10vh]',
  'py-[1px]',
  'right-[15%]',
  'ring-primary/40',
  'scale-[var(--hover-scale)]',
  'sm:min-w-[200px]',
  'sm:min-w-[300px]',
  'sm:w-[28rem]',
  'sm:w-[340px]',
  'sm:w-[480px]',
  'sm:w-[640px]',
  'text-[10px]',
  'text-[11px]',
  'text-[var(--color-danger)]',
  'text-[var(--color-primary)]',
  'text-[var(--color-success)]',
  'text-[var(--color-warning-foreground)]',
  'text-[var(--color-warning)]',
  'text-foreground/50',
  'top-[15%]',
  'translate-x-[1.25rem]',
  'w-[1.25rem]',
  'w-[2.75rem]',
  'w-[400px]',
  'z-[1]',
  'z-[45]',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-24)
  'border-border/60',
  'hover:bg-accent/40',
  'w-[243px]',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-25)
  'aspect-[21/9]',
  'aspect-[3/2]',
  'aspect-[4/3]',
  'max-w-[55%]',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-26)
  'max-w-[12rem]',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-27)
  'bg-error/5',
  'bg-success/5',
  'border-error/20',
  'border-success/20',

  // Auto-added by audit-tailwind-safelist.ts (2026-09-30)
  'bg-error/30',
  'bg-info/80',
  'bg-primary-foreground/20',
  'bg-primary-foreground/5',
  'bg-primary/25',
  'bg-secondary/80',
  'border-e-[length:var(--border-width)]',
  'border-s-[length:var(--border-width)]',
  'grid-cols-[repeat(auto-fit,minmax(min(10rem,100%),1fr))]',
  'max-h-[80%]',
  'max-w-[1440px]',
  'max-w-[16rem]',
  'min-w-[min(theme(minWidth.modal-sm),100%)]',
  'min-w-[min(theme(minWidth.modal-md),100%)]',
  'min-w-[min(theme(minWidth.modal-lg),100%)]',
  'min-w-[min(theme(minWidth.modal-xl),100%)]',
  'pb-[calc(5rem+env(safe-area-inset-bottom))]',
  'pb-[env(safe-area-inset-bottom)]',
  'pt-[10%]',
  'pt-[env(safe-area-inset-top)]',
  'rounded-[calc(var(--radius-xl)*1.5)]',
  'text-primary-foreground/80',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-01)
  'max-w-[18rem]',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-01)
  'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-02)
  'bg-primary/5',
  'from-[var(--color-background)]',
  'max-w-[90%]',
  'rounded-[inherit]',
  'rounded-[var(--radius-lg)]',
  'shadow-[var(--shadow-lg)]',
  'text-[var(--color-primary-foreground)]',
  'z-[850]',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-03)
  '[justify-content:inherit]',
  'bg-primary/[0.08]',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-04)
  'bg-[var(--surface-diagram)]',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-05)
  'hover:bg-accent/15',

  // Auto-added by audit-tailwind-safelist.ts (2026-10-21)
  "after:content-['']",
  'after:rounded-[inherit]',
  'grow-[1.6]',
],
  theme: {
    fontFamily: {
      // `sans` continues to read --font-family for backward compat.
      sans: ['var(--font-family)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      mono: ['var(--font-family-mono, ui-monospace)', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      // Layer 1 Type axis: display + body family slots fall back to --font-family
      // so existing themes that don't define them keep their current look.
      display: ['var(--font-family-display, var(--font-family))', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      body: ['var(--font-family-body, var(--font-family))', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    },
    extend: {
      // MarkdownContent draws its own inline-code chip; drop the plugin's literal backticks
      typography: {
        DEFAULT: {
          css: {
            'code::before': { content: 'none' },
            'code::after': { content: 'none' },
          },
        },
      },
      colors: {
        primary: {
          DEFAULT: withOpacity('--color-primary'),
          foreground: withOpacity('--color-primary-foreground'),
          hover: withOpacity('--color-primary-hover'),
        },
        secondary: {
          DEFAULT: withOpacity('--color-secondary'),
          foreground: withOpacity('--color-secondary-foreground'),
          hover: withOpacity('--color-secondary-hover'),
        },
        muted: {
          DEFAULT: withOpacity('--color-muted'),
          foreground: withOpacity('--color-muted-foreground'),
        },
        accent: {
          DEFAULT: withOpacity('--color-accent'),
          foreground: withOpacity('--color-accent-foreground'),
        },
        background: withOpacity('--color-background'),
        foreground: withOpacity('--color-foreground'),
        card: {
          DEFAULT: withOpacity('--color-card'),
          foreground: withOpacity('--color-card-foreground'),
        },
        surface: withOpacity('--color-surface'),
        // Backdrop dimming behind modals/drawers; themes set --color-scrim.
        scrim: 'var(--color-scrim, rgba(0, 0, 0, 0.6))',
        border: withOpacity('--color-border'),
        input: withOpacity('--color-input'),
        ring: withOpacity('--color-ring'),
        error: {
          DEFAULT: withOpacity('--color-error'),
          foreground: withOpacity('--color-error-foreground'),
        },
        success: {
          DEFAULT: withOpacity('--color-success'),
          foreground: withOpacity('--color-success-foreground'),
        },
        warning: {
          DEFAULT: withOpacity('--color-warning'),
          foreground: withOpacity('--color-warning-foreground'),
        },
        info: {
          DEFAULT: withOpacity('--color-info'),
          foreground: withOpacity('--color-info-foreground'),
        },
      },
      borderRadius: {
        none: 'var(--radius-none, 0)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
        // Geometry-axis intent overlay. Codemod targets these for `rounded-*` by component intent:
        //   Card / containers   → rounded-container
        //   Button / interactive → rounded-interactive
        //   Avatar / Badge      → rounded-pill
        container: 'var(--radius-container, var(--radius-md))',
        interactive: 'var(--radius-interactive, var(--radius-md))',
        pill: 'var(--radius-pill, var(--radius-full))',
      },
      borderWidth: {
        // Geometry-axis border rhythm with intent. Existing literal `border` / `border-2` keep working.
        hairline: 'var(--border-hairline, 1px)',
        standard: 'var(--border-standard, var(--border-width, 1px))',
        heavy: 'var(--border-heavy, var(--border-width-thick, 2px))',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-main)',
        lg: 'var(--shadow-lg)',
        inner: 'var(--shadow-inner)',
        // Elevation-axis per-layer intent. Codemod targets:
        //   Card                → shadow-elevation-card
        //   Popover / Tooltip   → shadow-elevation-popover
        //   Dialog              → shadow-elevation-dialog
        //   Toast               → shadow-elevation-toast
        'elevation-card': 'var(--elevation-card, var(--shadow-sm))',
        'elevation-popover': 'var(--elevation-popover, var(--shadow-main))',
        'elevation-dialog': 'var(--elevation-dialog, var(--shadow-lg))',
        'elevation-toast': 'var(--elevation-toast, var(--shadow-main))',
        //   Button resting / pressed → shadow-elevation-interactive / shadow-elevation-pressed
        'elevation-interactive': 'var(--elevation-interactive, var(--shadow-sm))',
        'elevation-pressed': 'var(--elevation-pressed, var(--shadow-sm))',
      },
      fontWeight: {
        normal: 'var(--font-weight-normal, 400)',
        medium: 'var(--font-weight-medium, 500)',
        bold: 'var(--font-weight-bold, 600)',
      },
      transitionDuration: {
        // DEFAULT drives every bare `transition-*` utility (transition-all /
        // transition-colors / ...) so its duration is theme-token-driven too —
        // not Tailwind's hardcoded 150ms. Existing aliases resolve through the
        // Motion-axis tokens with the legacy `--transition-*` as fallback.
        DEFAULT: 'var(--duration-fast, var(--transition-fast, 150ms))',
        fast: 'var(--duration-fast, var(--transition-fast, 150ms))',
        normal: 'var(--duration-normal, var(--transition-normal, 250ms))',
        slow: 'var(--duration-slow, var(--transition-slow, 400ms))',
        instant: 'var(--duration-instant, 0ms)',
        dramatic: 'var(--duration-dramatic, 600ms)',
      },
      transitionTimingFunction: {
        // DEFAULT drives every bare `transition-*` utility so its easing is
        // theme-token-driven — not Tailwind's hardcoded cubic-bezier. `standard`
        // falls back to legacy `--transition-timing` for backward compat.
        DEFAULT: 'var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        linear: 'var(--easing-linear, linear)',
        standard: 'var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        emphasized: 'var(--easing-emphasized, cubic-bezier(0.2, 0, 0, 1))',
        spring: 'var(--easing-spring, cubic-bezier(0.34, 1.56, 0.64, 1))',
      },
      keyframes: {
        'almadar-marquee': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(var(--marquee-shift, -50%))' },
        },
        'modal-in': {
          '0%': {
            opacity: 'var(--motion-modal-enter-from-opacity, 0)',
            transform: 'var(--motion-modal-enter-from-transform, scale(0.96) translateY(8px))',
          },
          '100%': {
            opacity: 'var(--motion-modal-enter-to-opacity, 1)',
            transform: 'var(--motion-modal-enter-to-transform, translateZ(0))',
          },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'modal-out': {
          '0%': {
            opacity: 'var(--motion-modal-exit-from-opacity, 1)',
            transform: 'var(--motion-modal-exit-from-transform, translateZ(0))',
          },
          '100%': {
            opacity: 'var(--motion-modal-exit-to-opacity, 0)',
            transform: 'var(--motion-modal-exit-to-transform, scale(0.96) translateY(8px))',
          },
        },
        'overlay-in': {
          '0%': { opacity: 'var(--motion-overlay-enter-from-opacity, var(--motion-overlay-from-opacity, 0))' },
          '100%': { opacity: '1' },
        },
        'overlay-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: 'var(--motion-overlay-exit-to-opacity, var(--motion-overlay-from-opacity, 0))' },
        },
        'slide-up': {
          '0%': {
            opacity: 'var(--motion-slide-up-from-opacity, 0)',
            transform: 'var(--motion-slide-up-from-transform, translateY(16px))',
          },
          '100%': {
            opacity: '1',
            transform: 'translateZ(0)',
          },
        },
        'drawer-in': {
          '0%': {
            opacity: 'var(--motion-drawer-enter-from-opacity, 0)',
            transform: 'var(--motion-drawer-enter-from-transform, translateX(calc(100% * var(--motion-drawer-sign, 1))))',
          },
          '100%': {
            opacity: 'var(--motion-drawer-enter-to-opacity, 1)',
            transform: 'var(--motion-drawer-enter-to-transform, translateZ(0))',
          },
        },
        'drawer-out': {
          '0%': {
            opacity: 'var(--motion-drawer-exit-from-opacity, 1)',
            transform: 'var(--motion-drawer-exit-from-transform, translateZ(0))',
          },
          '100%': {
            opacity: 'var(--motion-drawer-exit-to-opacity, 0)',
            transform: 'var(--motion-drawer-exit-to-transform, translateX(calc(100% * var(--motion-drawer-sign, 1))))',
          },
        },
        'popover-in': {
          '0%': {
            opacity: 'var(--motion-popover-enter-from-opacity, 0)',
            transform: 'var(--motion-popover-enter-from-transform, scale(0.95))',
          },
          '100%': {
            opacity: 'var(--motion-popover-enter-to-opacity, 1)',
            transform: 'var(--motion-popover-enter-to-transform, scale(1))',
          },
        },
        'popover-out': {
          '0%': {
            opacity: 'var(--motion-popover-exit-from-opacity, 1)',
            transform: 'var(--motion-popover-exit-from-transform, scale(1))',
          },
          '100%': {
            opacity: 'var(--motion-popover-exit-to-opacity, 0)',
            transform: 'var(--motion-popover-exit-to-transform, scale(0.95))',
          },
        },
        'toast-in': {
          '0%': {
            opacity: 'var(--motion-toast-enter-from-opacity, 0)',
            transform: 'var(--motion-toast-enter-from-transform, translateY(16px))',
          },
          '100%': {
            opacity: 'var(--motion-toast-enter-to-opacity, 1)',
            transform: 'var(--motion-toast-enter-to-transform, translateZ(0))',
          },
        },
        'toast-out': {
          '0%': {
            opacity: 'var(--motion-toast-exit-from-opacity, 1)',
            transform: 'var(--motion-toast-exit-from-transform, translateZ(0))',
          },
          '100%': {
            opacity: 'var(--motion-toast-exit-to-opacity, 0)',
            transform: 'var(--motion-toast-exit-to-transform, translateY(16px))',
          },
        },
        'fade-in': {
          '0%': { opacity: 'var(--motion-fade-enter-from-opacity, 0)' },
          '100%': { opacity: 'var(--motion-fade-enter-to-opacity, 1)' },
        },
        'fade-out': {
          '0%': { opacity: 'var(--motion-fade-exit-from-opacity, 1)' },
          '100%': { opacity: 'var(--motion-fade-exit-to-opacity, 0)' },
        },
        'page-in': {
          '0%': {
            opacity: 'var(--motion-page-enter-from-opacity, 0)',
            transform: 'var(--motion-page-enter-from-transform, translateY(8px))',
          },
          '100%': {
            opacity: 'var(--motion-page-enter-to-opacity, 1)',
            transform: 'var(--motion-page-enter-to-transform, translateZ(0))',
          },
        },
        'page-out': {
          '0%': {
            opacity: 'var(--motion-page-exit-from-opacity, 1)',
            transform: 'var(--motion-page-exit-from-transform, translateZ(0))',
          },
          '100%': {
            opacity: 'var(--motion-page-exit-to-opacity, 0)',
            transform: 'var(--motion-page-exit-to-transform, translateY(-8px))',
          },
        },
      },
      animation: {
        'almadar-marquee': 'almadar-marquee 40s linear infinite',
        // Motion-token-driven durations/easings (fall back to legacy
        // --transition-* so themes that haven't migrated keep working).
        'modal-in': 'modal-in var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        'modal-out': 'modal-out var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'overlay-in': 'overlay-in var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        'overlay-out': 'overlay-out var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'slide-up': 'slide-up var(--duration-slow, var(--transition-slow, 400ms)) var(--easing-emphasized, cubic-bezier(0.2, 0, 0, 1))',
        'drawer-in': 'drawer-in var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-emphasized, cubic-bezier(0.2, 0, 0, 1))',
        'drawer-out': 'drawer-out var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-emphasized, cubic-bezier(0.2, 0, 0, 1)) forwards',
        'popover-in': 'popover-in var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        'popover-out': 'popover-out var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'toast-in': 'toast-in var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-emphasized, cubic-bezier(0.2, 0, 0, 1))',
        'toast-out': 'toast-out var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'fade-in': 'fade-in var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        'fade-out': 'fade-out var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'page-in': 'page-in var(--duration-normal, var(--transition-normal, 250ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1)))',
        'page-out': 'page-out var(--duration-fast, var(--transition-fast, 150ms)) var(--easing-standard, var(--transition-timing, cubic-bezier(0.4, 0, 0.2, 1))) forwards',
        'shimmer': 'shimmer var(--duration-shimmer, 1.5s) var(--easing-linear, linear) infinite',
      },
      // Density-axis spacing scale. Tailwind's default `p-3` / `gap-4` resolve
      // here so existing classes keep working — but now read from tokens.
      // Defaults match Tailwind's default (12px / 16px / 24px for 3 / 4 / 6),
      // so post-migration visual output is identical until a theme overrides.
      spacing: {
        0: 'var(--space-0, 0px)',
        1: 'var(--space-1, 4px)',
        2: 'var(--space-2, 8px)',
        3: 'var(--space-3, 12px)',
        4: 'var(--space-4, 16px)',
        5: 'var(--space-5, 20px)',
        6: 'var(--space-6, 24px)',
        7: 'var(--space-7, 28px)',
        8: 'var(--space-8, 32px)',
        9: 'var(--space-9, 36px)',
        10: 'var(--space-10, 40px)',
        11: 'var(--space-11, 44px)',
        12: 'var(--space-12, 48px)',
        // Component-intent spacing (codemod targets for padding-by-intent)
        'card-sm': 'var(--card-padding-sm, 12px)',
        'card-md': 'var(--card-padding-md, 16px)',
        'card-lg': 'var(--card-padding-lg, 24px)',
        'dialog': 'var(--dialog-padding, 24px)',
        'section': 'var(--section-gap, 32px)',
      },
      // Type-axis size scale. Each step pairs a size with a line-height,
      // both read from tokens with Tailwind-default fallbacks so existing
      // `text-sm` resolves to the same 14px/20px until a theme overrides.
      fontSize: {
        xs: ['var(--text-xs, 12px)', { lineHeight: 'var(--leading-xs, 16px)' }],
        sm: ['var(--text-sm, 14px)', { lineHeight: 'var(--leading-sm, 20px)' }],
        base: ['var(--text-base, 16px)', { lineHeight: 'var(--leading-base, 24px)' }],
        lg: ['var(--text-lg, 18px)', { lineHeight: 'var(--leading-lg, 28px)' }],
        xl: ['var(--text-xl, 20px)', { lineHeight: 'var(--leading-xl, 28px)' }],
        '2xl': ['var(--text-2xl, 24px)', { lineHeight: 'var(--leading-2xl, 32px)' }],
        '3xl': ['var(--text-3xl, 30px)', { lineHeight: 'var(--leading-3xl, 36px)' }],
        '4xl': ['var(--text-4xl, 36px)', { lineHeight: 'var(--leading-4xl, 40px)' }],
        'display-1': ['var(--text-display-1, 48px)', { lineHeight: 'var(--leading-display-1, 52px)' }],
        'display-2': ['var(--text-display-2, 60px)', { lineHeight: 'var(--leading-display-2, 64px)' }],
      },
      // Density-axis per-element heights (codemod targets for `h-{px}` on
      // buttons / inputs / rows / icons).
      height: {
        'button-sm': 'var(--button-height-sm, 28px)',
        'button-md': 'var(--button-height-md, 36px)',
        'button-lg': 'var(--button-height-lg, 44px)',
        'input-sm': 'var(--input-height-sm, 28px)',
        'input-md': 'var(--input-height-md, 36px)',
        'input-lg': 'var(--input-height-lg, 44px)',
        'row-compact': 'var(--row-height-compact, 32px)',
        'row-normal': 'var(--row-height-normal, 40px)',
        'row-spacious': 'var(--row-height-spacious, 48px)',
        'icon-default': 'var(--icon-default-size, 16px)',
      },
      minHeight: {
        'button-sm': 'var(--button-height-sm, 28px)',
        'button-md': 'var(--button-height-md, 36px)',
        'button-lg': 'var(--button-height-lg, 44px)',
        'input-sm': 'var(--input-height-sm, 28px)',
        'input-md': 'var(--input-height-md, 36px)',
        'input-lg': 'var(--input-height-lg, 44px)',
        'row-compact': 'var(--row-height-compact, 32px)',
        'row-normal': 'var(--row-height-normal, 40px)',
        'row-spacious': 'var(--row-height-spacious, 48px)',
      },
      minWidth: Object.fromEntries(
        nativeTokens.sizes.minWidth.filter((e) => e.key.startsWith('modal-')).map((e) => [e.key, `${e.value / 16}rem`]),
      ),
      width: {
        'icon-default': 'var(--icon-default-size, 16px)',
      },
      // Geometry-axis radius rhythm (codemod targets for `rounded-*` by intent).
      // The existing sm/md/lg/xl/full keys above continue to work as-is.
      // Codemod converts `rounded-md` on Card → `rounded-container`, on Button → `rounded-interactive`, on Avatar/Badge → `rounded-pill`.
      // borderRadius is extended below alongside the existing radius tokens.
      // Elevation-axis per-layer shadow mapping.
      // Codemod converts `shadow-sm` on Card → `shadow-elevation-card`, etc.
      // boxShadow is extended below.
      // Container-query breakpoints aligned 1:1 with Tailwind's default
      // viewport breakpoints (sm 640 / md 768 / lg 1024 / xl 1280 /
      // 2xl 1536). Lets components use `@lg/foo:hidden` as a drop-in
      // replacement for `lg:hidden` when they're rendered inside a
      // CSS Container (the Studio preview, embedded iframes, etc.) so
      // the layout responds to the container's width, not the viewport.
      containers: {
        sm: `${nativeTokens.breakpoints.sm / 16}rem`,
        md: `${nativeTokens.breakpoints.md / 16}rem`,
        lg: `${nativeTokens.breakpoints.lg / 16}rem`,
        xl: `${nativeTokens.breakpoints.xl / 16}rem`,
        '2xl': `${nativeTokens.breakpoints.xxl / 16}rem`,
      },
    },
  },
  plugins: [
    // MarkdownContent styles itself with `prose`, themed via its --tw-prose-* vars
    require('@tailwindcss/typography'),
    // Chrome-skin utilities: sprite-driven panel/button chrome, opt-in per theme.
    // No-op (`none`) unless the active theme defines the backing --game-* vars —
    // zero visual change for every theme that doesn't set them.
    require('tailwindcss/plugin')(({ addBase, addUtilities }) => {
      // AnimatedReveal marks a band away from the viewport; nothing inside it needs to animate.
      addBase({ '[data-on-screen="false"] *': { 'animation-play-state': 'paused !important' } });
      addUtilities({
        '.chrome-panel': {
          'border-image-source': 'var(--game-panel-border-image, none)',
          'border-image-slice': 'var(--game-panel-border-image-slice, 30 fill)',
          'border-image-width': 'var(--game-panel-border-image-width, 30px)',
          'border-image-repeat': 'stretch',
        },
        // Heading voice: every heading reads the theme's display family + voice tokens.
        '.heading-voice': {
          'font-family': 'var(--font-family-display, var(--font-family))',
          'font-weight': 'var(--heading-weight, var(--font-weight-bold, 700))',
          'text-transform': 'var(--heading-transform, none)',
          'letter-spacing': 'var(--heading-tracking, var(--letter-spacing, normal))',
          'font-style': 'var(--heading-style, normal)',
          'text-shadow': 'var(--heading-shadow, none)',
        },
        // Surface material on panels (cards, dialogs, popovers, drawers).
        '.surface-material': {
          'background-image': 'var(--surface-card-image, none)',
          'backdrop-filter': 'var(--surface-backdrop, none)',
          '-webkit-backdrop-filter': 'var(--surface-backdrop, none)',
        },
        // Content surface: the box behind a content block (table, calendar, list,
        // chart …). Every value is a theme hook with a paint-site fallback, so a
        // [data-theme] subtree's colors apply (never alias these on :root).
        '.surface-content': {
          'background-color': 'var(--surface-content-bg, var(--color-card))',
          'background-image': 'var(--surface-card-image, none)',
          'backdrop-filter': 'var(--surface-backdrop, none)',
          '-webkit-backdrop-filter': 'var(--surface-backdrop, none)',
          'border-width': 'var(--surface-content-border-width, var(--border-width, 1px))',
          'border-color': 'var(--surface-content-border-color, var(--color-border))',
          'border-radius': 'var(--surface-content-radius, var(--radius-container, var(--radius-md)))',
          'box-shadow': 'var(--surface-content-shadow, var(--elevation-card, var(--shadow-sm)))',
        },
        // Logo / wordmark marquee (std-proof `proofLook: marquee`): two copies of the strip scroll as one loop.
        '.proof-marquee': {
          overflow: 'hidden',
          'mask-image': 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
          '-webkit-mask-image': 'linear-gradient(to right, transparent, black 8%, black 92%, transparent)',
        },
        '.proof-marquee-track': { display: 'flex', width: 'max-content' },
        // An RTL strip starts at the right edge, so the loop slides right.
        '[dir="rtl"] .proof-marquee-track': { '--marquee-shift': '50%' },
        // Full-width band layers (Box edgeTop/edgeBottom/texture/backdrop, std-hero scrim).
        '.band': { position: 'relative', overflow: 'hidden', isolation: 'isolate' },
        // Zero specificity: a child's own position utility (std-hero's absolute backdrop) must win.
        ':where(.band > :not([data-band-layer]))': { position: 'relative', 'z-index': '1' },
        '.band-backdrop': { position: 'absolute', inset: '0', 'pointer-events': 'none', 'z-index': '0' },
        '.band-backdrop img': { width: '100%', height: '100%', 'object-fit': 'cover' },
        '.band-scrim': {
          position: 'absolute', inset: '0', 'pointer-events': 'none', 'z-index': '0',
          'background-image': 'var(--surface-scrim, linear-gradient(to top, rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.15)))',
        },
        '.band-texture': {
          position: 'absolute', inset: '0', 'pointer-events': 'none', 'z-index': '0',
          'background-color': 'color-mix(in oklab, var(--color-primary) 14%, transparent)',
          'mask-image': "var(--surface-texture-mask, url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='3' cy='3' r='1.5'/></svg>\"))",
          '-webkit-mask-image': "var(--surface-texture-mask, url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><circle cx='3' cy='3' r='1.5'/></svg>\"))",
          'mask-size': 'var(--surface-texture-size, 24px 24px)',
          '-webkit-mask-size': 'var(--surface-texture-size, 24px 24px)',
          'mask-repeat': 'repeat',
          '-webkit-mask-repeat': 'repeat',
        },
        '.band-edge': {
          position: 'absolute', left: '0', right: '0', 'pointer-events': 'none', 'z-index': '0',
          'mask-size': '100% 100%', '-webkit-mask-size': '100% 100%',
          'mask-repeat': 'no-repeat', '-webkit-mask-repeat': 'no-repeat',
        },
        '.band-edge-top': { top: '0' },
        '.band-edge-bottom': { bottom: '0' },
        '.band-gradient': {
          'background-color': 'var(--color-muted)',
          'background-image': 'var(--surface-accent-image, linear-gradient(180deg, color-mix(in oklab, var(--color-primary) 12%, var(--color-background)), var(--color-background)))',
          color: 'var(--color-foreground)',
        },
        '.band-inverse': {
          '--band-fg': 'var(--color-foreground)',
          '--band-bg': 'var(--color-background)',
          'background-color': 'var(--color-foreground)',
          color: 'var(--color-background)',
        },
        '.band-inverse > :not([data-band-layer])': {
          '--color-foreground': 'var(--band-bg)',
          '--color-background': 'var(--band-fg)',
          '--color-card': 'color-mix(in oklab, var(--band-fg) 90%, var(--band-bg))',
          '--color-muted': 'color-mix(in oklab, var(--band-fg) 85%, var(--band-bg))',
          '--color-muted-foreground': 'color-mix(in oklab, var(--band-bg) 72%, var(--band-fg))',
          '--color-border': 'color-mix(in oklab, var(--band-bg) 22%, var(--band-fg))',
        },
        // Surface material on the page background (app shell / themed root).
        '.surface-page': {
          'background-image': 'var(--surface-page-image, none)',
          'background-size': 'var(--surface-page-image-size, auto)',
          'background-attachment': 'fixed',
        },
        // Interactive-control geometry: border style (outset bevel for Win95-style
        // chrome) and corner shape (round controls inside a scoop/notch frame).
        '.interactive-border': {
          'border-style': 'var(--border-style-interactive, var(--border-style, solid))',
          'corner-shape': 'var(--corner-shape-interactive, var(--corner-shape, round))',
        },
        '.chrome-button': {
          'background-image': 'var(--game-button-bg-image, none)',
          'background-size': 'var(--game-button-bg-size, 100% 100%)',
          'background-repeat': 'no-repeat',
          'background-position': 'center',
        },
      });
    }),
  ],
};
