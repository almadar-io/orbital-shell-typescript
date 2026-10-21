'use client';
/**
 * Component Pattern Wrappers
 *
 * Pattern wrappers for atomic UI components that can be rendered via render_ui.
 * These bridge the shell's atomic components with the pattern system.
 *
 * Interactive components emit events via useEventBus for the closed circuit pattern.
 *
 * @packageDocumentation
 */

import { actionTestId } from '@almadar/core';
import React from 'react';
import type { EventKey, EventPayload } from '@almadar/core';
import type { UiError } from '../../../core';
import { useEventBus } from '../../../core';

// Shell component imports
import { Button, type ButtonProps } from '../../../core';
import { Label } from '../../../core';
import { Typography } from '../../../core';
import { Alert, type AlertVariant } from '../molecules/Alert';
import { FloatingActionButton } from '../molecules/FloatingActionButton';
import { IconButton } from '../molecules/IconButton';

/**
 * Base closed circuit props required by all organism components.
 */
interface ClosedCircuitProps {
  className?: string;
  isLoading?: boolean;
  error?: UiError | null;
  entity?: string;
}

// ============================================================================
// Interactive Components (emit events via closed circuit)
// ============================================================================

/**
 * Props for {@link ButtonPattern}. A thin pass-through over the Button
 * atom: accepts every Button prop plus wrapper-level aliases for the
 * `.orb` schema convention (`action`/`event`/`onClick` as string
 * event names, `iconPosition` for left/right icon placement).
 *
 * Anything not explicitly named is forwarded to `<Button>` via rest-spread,
 * so a future Button prop lands automatically without needing a wrapper
 * edit. This is the contract that fixes VG17: `action: EventKey` flows
 * through to Button, which owns both `UI:{action}` emit AND the
 * `data-testid="action-{NAME}"` attribute the verifier selects on.
 */
export interface ButtonPatternProps extends Omit<ButtonProps, 'onClick'>, ClosedCircuitProps {
  /** Legacy alias for {@link ButtonProps.action} (string event name). */
  onClick?: EventKey;
  /** Legacy alias for {@link ButtonProps.action}. */
  event?: EventKey;
  /** Icon placement — maps to Button's `icon` (left) or `iconRight` (right). */
  iconPosition?: 'left' | 'right';
}

/**
 * Button pattern — thin pass-through to the Button atom.
 *
 * Prior to VG17 this wrapper owned a local event-bus emit and
 * hand-enumerated only a narrow slice of props, silently dropping
 * every prop outside that list (including the Pre-Phase `action:
 * EventKey`). The atom already handles emit + data-testid via its
 * `action` prop, so the wrapper simply forwards everything.
 */
export function ButtonPattern({
  action,
  onClick,
  event,
  icon,
  iconPosition,
  ...rest
}: ButtonPatternProps): React.ReactElement {
  const resolvedAction = action ?? onClick ?? event;
  // `iconPosition: 'right'` slots the icon into `iconRight`; anything
  // else (undefined or 'left') keeps it on the left via the `icon` alias.
  const iconProps: Pick<ButtonProps, 'icon' | 'iconRight'> =
    iconPosition === 'right' ? { iconRight: icon } : { icon };
  return <Button {...rest} action={resolvedAction} {...iconProps} />;
}

ButtonPattern.displayName = 'ButtonPattern';

export interface IconButtonPatternProps extends Omit<ButtonProps, 'onClick'>, ClosedCircuitProps {
  icon: string;
  ariaLabel?: string;
  /** Legacy alias for {@link ButtonProps.action}. */
  onClick?: EventKey;
  /** Legacy alias for {@link ButtonProps.action}. */
  event?: EventKey;
}

/**
 * Icon-only button pattern — pass-through to the Button atom with a
 * mandatory icon and optional aria-label. Same VG17 fix as
 * {@link ButtonPattern}: `action` forwards to the atom, which owns the
 * emit + data-testid.
 */
export function IconButtonPattern({
  action,
  onClick,
  event,
  icon,
  ariaLabel,
  variant = 'ghost',
  ...rest
}: IconButtonPatternProps): React.ReactElement {
  const resolvedAction = action ?? onClick ?? event;
  // A named icon button is the one icon-only control (label + tooltip); an unnamed one has nothing to show.
  const name = ariaLabel ?? rest['aria-label'] ?? rest.label;
  if (name) {
    const { label: _label, 'aria-label': _ariaLabel, ...named } = rest;
    return <IconButton {...named} variant={variant} action={resolvedAction} icon={icon} label={name} />;
  }
  return <Button {...rest} variant={variant} action={resolvedAction} icon={icon} />;
}

IconButtonPattern.displayName = 'IconButtonPattern';

export interface LinkPatternProps extends ClosedCircuitProps {
  label: string;
  href?: string;
  external?: boolean;
  /** Event key emitted on click (intercepts native navigation when set). */
  action?: EventKey;
  /** Legacy alias for action. */
  onClick?: EventKey;
  /** Legacy alias for action. */
  event?: EventKey;
  /** Payload for the dispatched event.
   *  @payloadFor action
   */
  actionPayload?: EventPayload;
  className?: string;
}

/**
 * Link pattern for navigation. When an event key is provided via
 * `action` / `onClick` / `event`, intercepts the native `<a>`
 * navigation and emits `UI:{action}` with the `href` in the payload.
 * Sets `data-testid="action-{NAME}"` so the verifier's click-path
 * gate can select it symmetrically with Button.
 */
export function LinkPattern({
  label,
  href,
  external = false,
  action,
  onClick,
  event,
  actionPayload,
  className,
}: LinkPatternProps): React.ReactElement {
  const { emit } = useEventBus();
  const resolvedAction = action ?? onClick ?? event;

  const handleClick = (e: React.MouseEvent) => {
    if (resolvedAction) {
      e.preventDefault();
      emit(`UI:${resolvedAction}`, actionPayload ?? ({ href } as EventPayload));
    }
  };

  return (
    <a
      href={href ?? '#'}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      onClick={resolvedAction ? handleClick : undefined}
      className={className}
      data-testid={resolvedAction ? actionTestId(resolvedAction) : undefined}
    >
      {label}
    </a>
  );
}

LinkPattern.displayName = 'LinkPattern';

// ============================================================================
// Display Components
// ============================================================================

export interface TextPatternProps extends ClosedCircuitProps {
  content: string;
  variant?: 'body' | 'caption' | 'overline';
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  color?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

/**
 * Text pattern for typography.
 */
export function TextPattern({
  content,
  variant = 'body',
  size = 'md',
  weight = 'normal',
  color,
  align,
  className,
}: TextPatternProps): React.ReactElement {
  return (
    <Typography
      variant={variant}
      size={size}
      weight={weight}
      className={className}
      style={{ color, textAlign: align }}
    >
      {content}
    </Typography>
  );
}

TextPattern.displayName = 'TextPattern';


// ============================================================================
// Form Input Components
// ============================================================================

export interface LabelPatternProps extends ClosedCircuitProps {
  text: string;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}

/**
 * Label pattern.
 */
export function LabelPattern({
  text,
  htmlFor,
  required = false,
  className,
}: LabelPatternProps): React.ReactElement {
  return (
    <Label htmlFor={htmlFor} required={required} className={className}>
      {text}
    </Label>
  );
}

LabelPattern.displayName = 'LabelPattern';

// ============================================================================
// Feedback Components
// ============================================================================

export interface AlertPatternProps extends ClosedCircuitProps {
  message: string;
  title?: string;
  variant?: AlertVariant;
  dismissible?: boolean;
  onDismiss?: string;
  className?: string;
}

/**
 * Alert pattern.
 */
export function AlertPattern({
  message,
  title,
  variant = 'info',
  dismissible = false,
  onDismiss,
  className,
}: AlertPatternProps): React.ReactElement {
  const { emit } = useEventBus();

  const handleDismiss = () => {
    if (onDismiss) {
      emit(`UI:${onDismiss}`, {});
    }
  };

  return (
    <Alert
      message={message}
      title={title}
      variant={variant}
      dismissible={dismissible}
      onDismiss={dismissible ? handleDismiss : undefined}
      className={className}
    />
  );
}

AlertPattern.displayName = 'AlertPattern';


// ============================================================================
// Navigation Components
// ============================================================================


// ============================================================================
// Layout Components
// ============================================================================


export interface FloatButtonPatternProps extends ClosedCircuitProps {
  icon: string;
  onClick?: string;
  position?: 'bottom-right' | 'bottom-left' | 'bottom-center';
  variant?: 'primary' | 'secondary';
  className?: string;
}

/**
 * Floating action button pattern.
 */
export function FloatButtonPattern({
  icon,
  onClick,
  position = 'bottom-right',
  variant = 'primary',
  className,
}: FloatButtonPatternProps): React.ReactElement {
  const { emit } = useEventBus();

  const handleClick = () => {
    if (onClick) {
      emit(`UI:${onClick}`, {});
    }
  };

  return (
    <FloatingActionButton
      icon={icon}
      onClick={handleClick}
      position={position}
      variant={variant}
      className={className}
    />
  );
}

FloatButtonPattern.displayName = 'FloatButtonPattern';

// ============================================================================
// Export Pattern Registry
// ============================================================================


export const COMPONENT_PATTERNS = {
  // Interactive
  'button': ButtonPattern,
  'icon-button': IconButtonPattern,
  'link': LinkPattern,
  // Display
  'text': TextPattern,
  // Form inputs
  'label': LabelPattern,
  // Feedback
  'alert': AlertPattern,
  // Layout
  'float-button': FloatButtonPattern,
} as const;
