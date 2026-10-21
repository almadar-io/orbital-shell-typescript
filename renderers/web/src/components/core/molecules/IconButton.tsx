'use client';
/**
 * IconButton — the one icon-only control. Its `label` is required: it is the
 * button's accessible name and, on hover or focus, its tooltip (none on touch
 * screens, where the tap is the action).
 */
import React from 'react';
import { Button, type ButtonProps } from '../../../core';
import { Icon, type IconInput } from '../../../core';
import { Tooltip, type TooltipPosition } from './Tooltip';
import { useMediaQuery } from '../../../core';

/** @accessibleName label */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'label' | 'icon' | 'leftIcon' | 'rightIcon' | 'iconRight'> {
  icon: IconInput;
  /** What the button does — its accessible name and its tooltip. */
  label: string;
  /** Where the tooltip opens. */
  tooltipPosition?: TooltipPosition;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ icon, label, tooltipPosition = 'right', variant = 'ghost', size = 'sm', className, ...rest }, ref) => {
    // Touch screens have no hover: the tap is the action, so no tooltip to leave behind (the label still names it).
    const touch = useMediaQuery('(hover: none)');
    const button = (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        className={`justify-center px-0 aspect-square ${className ?? ''}`}
        {...rest}
      >
        <Icon icon={icon} size="sm" />
      </Button>
    );
    return touch ? button : <Tooltip content={label} position={tooltipPosition}>{button}</Tooltip>;
  },
);

IconButton.displayName = 'IconButton';
