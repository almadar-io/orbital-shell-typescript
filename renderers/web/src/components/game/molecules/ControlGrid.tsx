'use client';
import * as React from 'react';
import type { A11yProps, EventEmit, EventKey, Asset } from '@almadar/core';
import { domPassthrough } from '../../../core';
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Box } from '../../../core';
import { ControlButton } from '../atoms/ControlButton';
import type { IconInput } from '../../../core';

// ControlGrid unifies ActionButtons (arbitrary button sets) and DPad (directional pad).
// kind="actions" — configurable button set with press/release tracking (horizontal/vertical/diamond layout).
// kind="dpad"    — 4-direction pad (up/down/left/right) with optional diagonal support.

export type ControlGridKind = 'dpad' | 'actions';

export interface ControlGridButton {
  id: string;
  label?: string;
  icon?: IconInput;
  assetUrl?: Asset;
  variant?: 'primary' | 'secondary' | 'ghost' | string;
}

export type DPadDirection = 'up' | 'down' | 'left' | 'right';

export interface ControlGridProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
  kind: ControlGridKind;
  /** action buttons (kind="actions") */
  buttons?: ControlGridButton[];
  /** Layout for kind="actions" */
  layout?: 'horizontal' | 'vertical' | 'diamond';
  /** Whether to include diagonal buttons (kind="dpad") */
  includeDiagonals?: boolean;
  /** Called when a button/direction is pressed or released */
  onAction?: (id: string, pressed: boolean) => void;
  /** Event-bus event emitted with `{ id, pressed }` on press/release */
  actionEvent?: EventEmit<{ id: string; pressed: boolean }>;
  /** Called when a direction is pressed or released (kind="dpad" convenience overload) */
  onDirection?: (direction: DPadDirection, pressed: boolean) => void;
  /** Event-bus event emitted with `{ direction, pressed }` (kind="dpad") */
  directionEvent?: EventEmit<{ direction: DPadDirection; pressed: boolean }>;
  /** Per-direction PRESS → the board's SEMANTIC event (kind="dpad"), e.g. `{ left: "LEFT", right: "RIGHT", up: "JUMP" }`.
   *  Lets the d-pad emit the SAME intent events as the keyboard so the FSM stays device-agnostic. */
  directionEvents?: Partial<Record<DPadDirection, EventKey>>;
  /** Per-direction RELEASE → semantic event, e.g. `{ left: "STOP", right: "STOP" }`. Omit a direction to ignore its release. */
  directionReleaseEvents?: Partial<Record<DPadDirection, EventKey>>;
  /** Per-direction sprite assets for kind="dpad" buttons (e.g. Kenny arrow PNGs). Falls back to arrow emoji. */
  directionAssets?: Partial<Record<DPadDirection, Asset>>;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  /** "auto" (default) renders only on coarse-pointer (touch) devices; "always" renders everywhere. */
  visibility?: 'auto' | 'always';
  className?: string;
}

const sizeKey = { sm: 'sm' as const, md: 'md' as const, lg: 'lg' as const };

const layoutClass = {
  horizontal: 'flex flex-row gap-2',
  vertical: 'flex flex-col gap-2',
  diamond: 'grid grid-cols-3 gap-1',
};

const dpadSizeMap = {
  sm: { gap: 'gap-0.5', container: 'w-28' },
  md: { gap: 'gap-1', container: 'w-40' },
  lg: { gap: 'gap-1.5', container: 'w-52' },
};

const arrowIcons: Record<DPadDirection, string> = {
  up: '▲',
  down: '▼',
  left: '◀',
  right: '▶',
};

const DEFAULT_BUTTON_KEYS: ReadonlyArray<Omit<ControlGridButton, 'label'> & { labelKey: string }> = [
  { id: 'jump', labelKey: 'controlGrid.jump', icon: 'chevron-up', variant: 'primary' },
  { id: 'attack', labelKey: 'controlGrid.attack', icon: 'sword', variant: 'secondary' },
  { id: 'dodge', labelKey: 'controlGrid.dodge', icon: 'wind', variant: 'ghost' },
];

export function ControlGrid({
  kind,
  buttons: buttonsProp,
  layout = 'horizontal',
  includeDiagonals = false,
  onAction,
  actionEvent,
  onDirection,
  directionEvent,
  directionEvents,
  directionReleaseEvents,
  directionAssets,
  size = 'md',
  disabled,
  visibility = 'auto',
  className,
  ...rest
}: ControlGridProps): React.JSX.Element | null {
  const eventBus = useEventBus();
  const { t } = useTranslate();
  const buttons: ControlGridButton[] = buttonsProp ?? DEFAULT_BUTTON_KEYS.map(({ labelKey, ...rest }) => ({ ...rest, label: t(labelKey) }));
  const [active, setActive] = React.useState<Set<string>>(new Set());
  const [coarse, setCoarse] = React.useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  );

  React.useEffect(() => {
    if (visibility !== 'auto' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [visibility]);

  const handlePress = React.useCallback(
    (id: string) => {
      setActive((prev) => new Set(prev).add(id));
      if (actionEvent) eventBus.emit(`UI:${actionEvent}`, { id, pressed: true });
      onAction?.(id, true);
      if (kind === 'dpad') {
        const semantic = directionEvents?.[id as DPadDirection];
        if (semantic) eventBus.emit(`UI:${semantic}`, {});
        if (directionEvent) eventBus.emit(`UI:${directionEvent}`, { direction: id as DPadDirection, pressed: true });
        onDirection?.(id as DPadDirection, true);
      }
    },
    [kind, actionEvent, directionEvent, directionEvents, eventBus, onAction, onDirection],
  );

  const handleRelease = React.useCallback(
    (id: string) => {
      setActive((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (actionEvent) eventBus.emit(`UI:${actionEvent}`, { id, pressed: false });
      onAction?.(id, false);
      if (kind === 'dpad') {
        const semantic = directionReleaseEvents?.[id as DPadDirection];
        if (semantic) eventBus.emit(`UI:${semantic}`, {});
        if (directionEvent) eventBus.emit(`UI:${directionEvent}`, { direction: id as DPadDirection, pressed: false });
        onDirection?.(id as DPadDirection, false);
      }
    },
    [kind, actionEvent, directionEvent, directionReleaseEvents, eventBus, onAction, onDirection],
  );

  if (visibility === 'auto' && !coarse) return null;

  if (kind === 'dpad') {
    const ds = dpadSizeMap[size];
    const dir = (d: DPadDirection) => (
      <ControlButton
        key={d}
        icon={directionAssets?.[d] ? undefined : arrowIcons[d]}
        assetUrl={directionAssets?.[d]}
        size={sizeKey[size]}
        variant="secondary"
        pressed={active.has(d)}
        onPress={() => handlePress(d)}
        onRelease={() => handleRelease(d)}
        disabled={disabled}
      />
    );
    // Render a directional cell only when that direction is actionable. With a
    // `directionEvents` map, that means the direction is present in it — so a
    // steer-only board (left/right) shows a 2-button pad, not a 4-cross with
    // dead up/down cells. Legacy generic handlers (no map) keep the full cross.
    const usesSemantic = !!directionEvents;
    const cell = (d: DPadDirection) =>
      !usesSemantic || directionEvents?.[d] ? dir(d) : <Box key={d} />;
    return (
      <Box {...domPassthrough(rest)} className={cn('inline-grid grid-cols-3', ds.gap, ds.container, className)}>
        <Box />{cell('up')}<Box />
        {cell('left')}
        <Box className="flex items-center justify-center">
          <Box className="w-6 h-6 rounded-interactive bg-muted border-heavy border-muted-foreground" />
        </Box>
        {cell('right')}
        <Box />{cell('down')}<Box />
      </Box>
    );
  }

  // kind="actions"
  if (layout === 'diamond' && buttons.length === 4) {
    const [top, right, bottom, left] = buttons;
    return (
      <Box {...domPassthrough(rest)} className={cn(layoutClass.diamond, className)}>
        <Box />
        <ControlButton icon={top.icon} assetUrl={top.assetUrl} label={top.label} size={sizeKey[size]} variant={top.variant}
          pressed={active.has(top.id)} onPress={() => handlePress(top.id)} onRelease={() => handleRelease(top.id)} disabled={disabled} />
        <Box />
        <ControlButton icon={left.icon} assetUrl={left.assetUrl} label={left.label} size={sizeKey[size]} variant={left.variant}
          pressed={active.has(left.id)} onPress={() => handlePress(left.id)} onRelease={() => handleRelease(left.id)} disabled={disabled} />
        <Box />
        <ControlButton icon={right.icon} assetUrl={right.assetUrl} label={right.label} size={sizeKey[size]} variant={right.variant}
          pressed={active.has(right.id)} onPress={() => handlePress(right.id)} onRelease={() => handleRelease(right.id)} disabled={disabled} />
        <Box />
        <ControlButton icon={bottom.icon} assetUrl={bottom.assetUrl} label={bottom.label} size={sizeKey[size]} variant={bottom.variant}
          pressed={active.has(bottom.id)} onPress={() => handlePress(bottom.id)} onRelease={() => handleRelease(bottom.id)} disabled={disabled} />
        <Box />
      </Box>
    );
  }

  return (
    <Box {...domPassthrough(rest)} className={cn(layoutClass[layout], className)}>
      {buttons.map((button) => (
        <ControlButton
          key={button.id}
          icon={button.icon}
          assetUrl={button.assetUrl}
          label={button.label}
          size={sizeKey[size]}
          variant={button.variant}
          pressed={active.has(button.id)}
          onPress={() => handlePress(button.id)}
          onRelease={() => handleRelease(button.id)}
          disabled={disabled}
        />
      ))}
    </Box>
  );
}

ControlGrid.displayName = 'ControlGrid';
