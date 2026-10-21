'use client';
import React from "react";
import { LOADING_STATE_MARKER } from "@almadar/core";
import type { A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { Box } from '../../../core';
import { Spinner } from '../../../core';
import { VStack } from '../../../core';
import { Typography } from '../../../core';
import { useTranslate } from '../../../core';

import { domPassthrough } from '../../../core';
export interface LoadingStateProps extends A11yProps {
  title?: string;
  message?: string;
  className?: string;
  /** Center over the whole viewport (fix: inset-0 overlay) instead of inline. */
  fullPage?: boolean;
}

export const LoadingState: React.FC<LoadingStateProps> = ({
  title,
  message,
  className,
  fullPage = false,
  ...rest
}) => {
  const { t } = useTranslate();
  const displayMessage = message ?? t('common.loading');
  return (
    <Box {...domPassthrough(rest)} className="contents" {...{ [LOADING_STATE_MARKER]: "" }}>
      <VStack
        align="center"
        className={cn(
          "justify-center",
          fullPage
            ? "fixed inset-0 z-[1000] py-12 bg-background/80 backdrop-blur-sm animate-overlay-in"
            : "py-12",
          className,
        )}
      >
        <Spinner size="lg" />
        {title && (
          <Typography variant="h3" className="mt-4 text-lg text-foreground">
            {title}
          </Typography>
        )}
        <Typography
          variant="small"
          className={cn(
            "text-muted-foreground",
            title ? "mt-2" : "mt-4",
          )}
        >
          {displayMessage}
        </Typography>
      </VStack>
    </Box>
  );
};

LoadingState.displayName = "LoadingState";
