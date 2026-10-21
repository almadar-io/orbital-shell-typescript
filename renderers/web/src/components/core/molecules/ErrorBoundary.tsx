'use client';

import React from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { cn } from '../../../core';
import { ErrorState } from './ErrorState';
import { useTranslate } from '../../../core';

const DefaultFallback: React.FC<{ error: Error; onRetry: () => void }> = ({ error, onRetry }) => {
  const { t } = useTranslate();
  return (
    <ErrorState
      title={t('error.somethingWentWrong')}
      message={error.message}
      onRetry={onRetry}
    />
  );
};

export interface ErrorBoundaryProps {
  /** Content to render when no error */
  children: ReactNode;
  /** Fallback UI when an error is caught — ReactNode or render function */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** Additional CSS classes for the wrapper */
  className?: string;
  /**
   * Called when an error is caught (for logging/telemetry)
   * @notification
   */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * ErrorBoundary — catches React render errors in child components.
 *
 * Uses `getDerivedStateFromError` and `componentDidCatch` to capture errors
 * and render a fallback UI. Supports both static ReactNode fallbacks and
 * render-function fallbacks that receive the error and a reset function.
 *
 * @example
 * ```tsx
 * // Static fallback
 * <ErrorBoundary fallback={<Alert variant="error">Something broke</Alert>}>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * // Render function fallback with reset
 * <ErrorBoundary fallback={(error, reset) => (
 *   <VStack>
 *     <Typography>Error: {error.message}</Typography>
 *     <Button onClick={reset}>Try Again</Button>
 *   </VStack>
 * )}>
 *   <MyComponent />
 * </ErrorBoundary>
 *
 * // Default fallback (uses ErrorState molecule)
 * <ErrorBoundary>
 *   <MyComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  static displayName = 'ErrorBoundary';

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.props.onError?.(error, errorInfo);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    const { children, fallback, className } = this.props;

    if (error) {
      const fallbackNode = typeof fallback === 'function'
        ? fallback(error, this.reset)
        : fallback || <DefaultFallback error={error} onRetry={this.reset} />;
      return className ? <div className={cn(className)}>{fallbackNode}</div> : fallbackNode;
    }

    return children;
  }
}

export default ErrorBoundary;
