'use client';
import React from "react";
import type { EventEmit, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Button } from '../../../core';
import { Box } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { Icon } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface ErrorStateProps extends A11yProps {
  title?: string;
  /** Error message to display */
  message?: string;
  /** Alias for message (schema compatibility) */
  description?: string;
  onRetry?: () => void;
  className?: string;
  /** Declarative retry event — emits UI:{retryEvent} via eventBus when retry button is clicked */
  retryEvent?: EventEmit<Record<string, never>>;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title,
  message,
  description,
  onRetry,
  className,
  retryEvent,
  ...rest
}) => {
  const eventBus = useEventBus();
  const { t } = useTranslate();

  const handleRetry = () => {
    if (retryEvent) eventBus.emit(`UI:${retryEvent}`, {});
    onRetry?.();
  };
  // Resolve alias: description → message
  const resolvedTitle = title ?? t('error.generic');
  const resolvedMessage = message ?? description ?? t('error.occurred');
  return (
    <VStack
      {...domPassthrough(rest)}
      align="center"
      className={cn(
        "justify-center py-12 text-center",
        className,
      )}
    >
      <Box className="mb-4 rounded-full bg-error/10 p-3">
        <Icon name="alert-circle" className="h-8 w-8 text-error" />
      </Box>
      <Typography variant="h3" className="text-lg text-foreground">
        {resolvedTitle}
      </Typography>
      <Typography variant="small" className="mt-1 text-muted-foreground max-w-sm">
        {resolvedMessage}
      </Typography>
      {(onRetry || retryEvent) && (
        <Button variant="secondary" className="mt-4" onClick={handleRetry}>
          {t('error.retry')}
        </Button>
      )}
    </VStack>
  );
};

ErrorState.displayName = "ErrorState";
