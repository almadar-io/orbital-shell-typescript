/**
 * Canvas3DErrorBoundary
 *
 * Error boundary for 3D canvas components.
 * Catches Three.js and React Three Fiber errors gracefully.
 *
 * @packageDocumentation
 */

import React, { Component, type ReactNode, type ErrorInfo } from 'react';
import { createLogger } from '@almadar/logger';
import { useTranslate } from '../../../core';
import './Canvas3DErrorBoundary.css';

const log = createLogger('almadar:ui:game:canvas3d:error-boundary');

export interface Canvas3DErrorBoundaryProps {
    /** Child components */
    children: ReactNode;
    /** Custom fallback component */
    fallback?: ReactNode;
    /** Error callback */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
    /** Reset callback */
    onReset?: () => void;
}

export interface Canvas3DErrorBoundaryState {
    /** Whether an error has occurred */
    hasError: boolean;
    /** The error that occurred */
    error: Error | null;
    /** Error info from React */
    errorInfo: ErrorInfo | null;
}

interface Canvas3DErrorFallbackProps {
    error: Error | null;
    errorInfo: ErrorInfo | null;
    onReset: () => void;
}

/** Function child so the class boundary can reach the translation hook. */
function Canvas3DErrorFallback({ error, errorInfo, onReset }: Canvas3DErrorFallbackProps): React.JSX.Element {
    const { t } = useTranslate();
    return (
        <div className="canvas-3d-error">
            <div className="canvas-3d-error__content">
                <div className="canvas-3d-error__icon">⚠️</div>
                <h2 className="canvas-3d-error__title">{t('canvas3d.errorTitle')}</h2>
                <p className="canvas-3d-error__message">{t('canvas3d.errorMessage')}</p>

                {error && (
                    <details className="canvas-3d-error__details">
                        <summary>{t('canvas3d.errorDetails')}</summary>
                        <pre className="error__stack">
                            {error.message}
                            {'\n'}
                            {error.stack}
                        </pre>
                        {errorInfo && (
                            <pre className="error__component-stack">
                                {errorInfo.componentStack}
                            </pre>
                        )}
                    </details>
                )}

                <div className="canvas-3d-error__actions">
                    <button
                        className="error__button error__button--primary"
                        onClick={onReset}
                    >
                        {t('common.retry')}
                    </button>
                    <button
                        className="error__button error__button--secondary"
                        onClick={() => window.location.reload()}
                    >
                        {t('canvas3d.reloadPage')}
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * Canvas3DErrorBoundary Component
 *
 * Catches errors in 3D canvas and displays a user-friendly fallback.
 *
 * @example
 * ```tsx
 * <Canvas3DErrorBoundary
 *     onError={(error) => console.error('3D Error:', error)}
 *     onReset={() => console.log('Resetting...')}
 * >
 *     <GameCanvas3D {...props} />
 * </Canvas3DErrorBoundary>
 * ```
 */
export class Canvas3DErrorBoundary extends Component<
    Canvas3DErrorBoundaryProps,
    Canvas3DErrorBoundaryState
> {
    constructor(props: Canvas3DErrorBoundaryProps) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null,
        };
    }

    static getDerivedStateFromError(error: Error): Canvas3DErrorBoundaryState {
        return {
            hasError: true,
            error,
            errorInfo: null,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        this.setState({ errorInfo });
        this.props.onError?.(error, errorInfo);

        log.error('Error caught', { error });
        log.error('Component stack', { componentStack: errorInfo.componentStack ?? '<none>' });
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
        this.props.onReset?.();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            // Custom fallback
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <Canvas3DErrorFallback
                    error={this.state.error}
                    errorInfo={this.state.errorInfo}
                    onReset={this.handleReset}
                />
            );
        }

        return this.props.children;
    }
}

export default Canvas3DErrorBoundary;
