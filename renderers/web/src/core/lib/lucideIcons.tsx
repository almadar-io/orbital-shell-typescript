import React from 'react';
import { HelpCircle, X, Trash2, Loader2, Square, Volume2, VolumeX, ArrowUpNarrowWide, ArrowDownNarrowWide, RefreshCw, Share2 } from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import dynamicIconImports from 'lucide-react/dynamicIconImports.mjs';

/** Kebab-case to PascalCase: 'shopping-cart' -> 'ShoppingCart', 'trash-2' -> 'Trash2'. */
export function kebabToPascal(name: string): string {
  return name
    .split('-')
    .map((part) => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

const ALIASES: Record<string, LucideIcon> = {
  close: X,
  trash: Trash2,
  loader: Loader2,
  stop: Square,
  volume: Volume2,
  'volume-off': VolumeX,
  refresh: RefreshCw,
  share: Share2,
  'sort-asc': ArrowUpNarrowWide,
  'sort-desc': ArrowDownNarrowWide,
};

type IconModule = { default: LucideIcon };
const LOADERS: Readonly<Record<string, () => Promise<IconModule>>> = dynamicIconImports;

let keyByPascal: Map<string, string> | undefined;

/** The lucide module key for a kebab-case or PascalCase icon name; undefined when lucide has no such icon. */
export function lucideIconKey(name: string): string | undefined {
  if (name in LOADERS) return name;
  if (keyByPascal === undefined) {
    keyByPascal = new Map();
    for (const key of Object.keys(LOADERS)) {
      const pascal = kebabToPascal(key);
      if (!keyByPascal.has(pascal)) keyByPascal.set(pascal, key);
    }
  }
  return keyByPascal.get(kebabToPascal(name)) ?? keyByPascal.get(name);
}

const loaded = new Map<string, LucideIcon>();
const pending = new Map<string, Promise<LucideIcon>>();

function load(key: string): Promise<LucideIcon> {
  const ready = loaded.get(key);
  if (ready !== undefined) return Promise.resolve(ready);
  let inflight = pending.get(key);
  if (inflight === undefined) {
    const loader = LOADERS[key];
    if (loader === undefined) return Promise.resolve(HelpCircle);
    inflight = loader().then((m) => {
      loaded.set(key, m.default);
      return m.default;
    });
    pending.set(key, inflight);
  }
  return inflight;
}

const adapters = new Map<string, LucideIcon>();

function makeLazyIcon(key: string): LucideIcon {
  const LazyIcon = React.forwardRef<SVGSVGElement, LucideProps>((props, ref) => {
    const [Icon, setIcon] = React.useState<LucideIcon | undefined>(() => loaded.get(key));
    React.useEffect(() => {
      if (Icon !== undefined) return undefined;
      let live = true;
      void load(key).then((component) => {
        if (live) setIcon(() => component);
      });
      return () => {
        live = false;
      };
    }, [Icon]);
    if (Icon !== undefined) return <Icon ref={ref} {...props} />;
    const { className, style, size = 24 } = props;
    return <svg ref={ref} width={size} height={size} className={className} style={style} aria-hidden="true" />;
  });
  LazyIcon.displayName = `LazyLucide(${key})`;
  return LazyIcon;
}

/**
 * Resolve an icon name to a lucide component, sync. Aliases and the help glyph are bundled; every other icon
 * is its own on-demand module, so a client downloads only the icons its program names.
 */
export function resolveLucideByName(name: string): LucideIcon {
  const alias = ALIASES[name];
  if (alias !== undefined) return alias;
  const key = lucideIconKey(name);
  if (key === undefined) return HelpCircle;
  let adapter = adapters.get(key);
  if (adapter === undefined) {
    adapter = makeLazyIcon(key);
    adapters.set(key, adapter);
  }
  return adapter;
}
