/**
 * FormField Molecule Component
 * 
 * A form field wrapper with label, hint, and error message support.
 * **Atomic Design**: Composed using Label and Typography atoms.
 */

import type { A11yProps } from '@almadar/core';
import React from 'react';
import { Label } from '../../../core';
import { Typography } from '../../../core';
import { VStack } from '../../../core';

import { domPassthrough } from '../../../core';
interface FieldChildProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export interface FormFieldProps extends A11yProps {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  required,
  error,
  hint,
  className,
  children,
  ...rest
}) => {
  // A single field child is named by the label (its own id kept when given)
  // and described by the hint or error.
  const generatedId = React.useId();
  const field = React.Children.count(children) === 1 && React.isValidElement<FieldChildProps>(children)
    ? children
    : null;
  const fieldId = field ? field.props.id ?? generatedId : undefined;
  const baseId = fieldId ?? generatedId;
  const hintId = `${baseId}-hint`;
  const errorId = `${baseId}-error`;
  const describedBy = [field?.props['aria-describedby'], error ? errorId : hint ? hintId : undefined]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <VStack {...domPassthrough(rest)} gap="xs" className={className}>
      <Label required={required} htmlFor={fieldId}>{label}</Label>
      {field
        ? React.cloneElement(field, {
            id: fieldId,
            'aria-describedby': describedBy,
            'aria-invalid': error ? true : field.props['aria-invalid'],
          })
        : children}
      {error && (
        <Typography id={errorId} variant="caption" color="error" data-field-error>
          {error}
        </Typography>
      )}
      {hint && !error && (
        <Typography id={hintId} variant="caption" color="muted">
          {hint}
        </Typography>
      )}
    </VStack>
  );
};

FormField.displayName = 'FormField';
