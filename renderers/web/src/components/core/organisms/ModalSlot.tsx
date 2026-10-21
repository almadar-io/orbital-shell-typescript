'use client';
/**
 * ModalSlot Component
 *
 * Wraps modal slot content in a proper Modal component.
 * Used by trait-driven pages to display modal UI from render_ui effects.
 *
 * Handles:
 * - Auto-open when content is present
 * - Dispatches CLOSE/CANCEL events when closed
 * - Extracts title from Form components
 */

import React from 'react';
import { Modal } from '../molecules/Modal';
import { useEventBus } from '../../../core';
import { useEntitySchemaOptional } from '../../../providers/EntitySchemaContext';
import { RenderSlotProvider } from '../../../providers/RenderSlotContext';
import type { UiError } from '../../../core';

export interface ModalSlotProps {
  /** Content to display in the modal */
  children?: React.ReactNode;
  /** Override modal title (extracted from children if not provided) */
  title?: string;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Custom class name */
  className?: string;
  /** Loading state indicator */
  isLoading?: boolean;
  /** Error state */
  error?: UiError | null;
  /** Entity name for schema-driven auto-fetch */
  entity?: string;
  /** Source trait name for qualified event emission */
  sourceTrait?: string;
}

/**
 * Extract title from Form or other components if they have a title prop
 */
function extractTitle(children: React.ReactNode): string | undefined {
  if (!React.isValidElement(children)) return undefined;

  const props = children.props as { title?: string | number | boolean | null };
  if (typeof props.title === 'string') {
    return props.title;
  }

  return undefined;
}

/**
 * ModalSlot - Wrapper for modal slot content
 *
 * Automatically shows modal when children are present,
 * and dispatches close events when modal is dismissed.
 */
export const ModalSlot: React.FC<ModalSlotProps> = ({
  children,
  title: overrideTitle,
  size = 'md',
  className,
  sourceTrait,
}) => {
  const eventBus = useEventBus();
  const schemaCtx = useEntitySchemaOptional();
  const isOpen = Boolean(children);

  // Extract title from children if not explicitly provided
  const title = overrideTitle || extractTitle(children);

  const handleClose = () => {
    const orbital = sourceTrait !== undefined && schemaCtx !== null
      ? schemaCtx.orbitalsByTrait.get(sourceTrait)
      : undefined;
    const prefix = orbital !== undefined && sourceTrait !== undefined
      ? `UI:${orbital}.${sourceTrait}.`
      : 'UI:';
    eventBus.emit(`${prefix}CLOSE`);
    eventBus.emit(`${prefix}CANCEL`);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title}
      size={size}
      className={className}
    >
      <RenderSlotProvider slot="modal">{children}</RenderSlotProvider>
    </Modal>
  );
};

ModalSlot.displayName = 'ModalSlot';
