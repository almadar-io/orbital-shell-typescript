/**
 * Canvas3DLoadingState
 *
 * Loading state component for 3D canvas with progress indicator.
 * Displays asset loading progress and estimated time remaining.
 *
 * @packageDocumentation
 */

import React from 'react';
import { useTranslate } from '../../../core';
import './Canvas3DLoadingState.css';

export interface Canvas3DLoadingStateProps {
    /** Current loading progress (0-100) */
    progress?: number;
    /** Number of assets loaded */
    loaded?: number;
    /** Total assets to load */
    total?: number;
    /** Loading message */
    message?: string;
    /** Secondary details message */
    details?: string;
    /** Whether to show spinner */
    showSpinner?: boolean;
    /** Custom className */
    className?: string;
}

/**
 * Canvas3DLoadingState Component
 *
 * Displays loading progress for 3D assets.
 *
 * @example
 * ```tsx
 * <Canvas3DLoadingState
 *     progress={65}
 *     loaded={13}
 *     total={20}
 *     message="Loading 3D models..."
 *     details="character-knight.glb"
 * />
 * ```
 */
export function Canvas3DLoadingState({
    progress = 0,
    loaded = 0,
    total = 0,
    message: messageProp,
    details,
    showSpinner = true,
    className,
}: Canvas3DLoadingStateProps): React.JSX.Element {
    const { t, locale } = useTranslate();
    const message = messageProp ?? t('canvas3d.loadingScene');
    const numberFormat = new Intl.NumberFormat(locale);
    const clampedProgress = Math.max(0, Math.min(100, progress));
    const hasProgress = total > 0;

    return (
        <div className={`canvas-3d-loading ${className || ''}`}>
            <div className="canvas-3d-loading__content">
                {showSpinner && (
                    <div className="canvas-3d-loading__spinner">
                        <div className="spinner__ring" />
                        <div className="spinner__ring spinner__ring--secondary" />
                    </div>
                )}

                <div className="canvas-3d-loading__message">{message}</div>

                {details && <div className="canvas-3d-loading__details">{details}</div>}

                {hasProgress && (
                    <div className="canvas-3d-loading__progress">
                        <div className="progress__bar">
                            <div
                                className="progress__fill"
                                style={{ width: `${clampedProgress}%` }}
                            />
                        </div>
                        <div className="progress__text">
                            <span className="progress__percentage">{new Intl.NumberFormat(locale, { style: 'percent' }).format(clampedProgress / 100)}</span>
                            <span className="progress__count">
                                ({numberFormat.format(loaded)}/{numberFormat.format(total)})
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Background grid pattern */}
            <div className="canvas-3d-loading__background">
                <div className="bg__grid" />
            </div>
        </div>
    );
}

export default Canvas3DLoadingState;
