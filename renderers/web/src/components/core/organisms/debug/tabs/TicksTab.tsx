/**
 * TicksTab - Displays tick execution timing and status
 * Uses existing component library atoms/molecules.
 */

import * as React from 'react';
import type { TickExecution } from '../../../../../lib/tickRegistry';
import { Badge } from '../../../../../core';
import { Typography } from '../../../../../core';
import { Stack } from '../../../../../core';
import { Card } from '../../../../../core';
import { EmptyState } from '../../../molecules/EmptyState';
import { useTranslate } from '../../../../../core';

interface TicksTabProps {
    ticks: TickExecution[];
}

export function TicksTab({ ticks }: TicksTabProps) {
    const { t, locale } = useTranslate();
    const numberFormat = new Intl.NumberFormat(locale);
    const activeTicks = ticks.filter(tick => tick.active);
    const inactiveTicks = ticks.filter(tick => !tick.active);

    if (ticks.length === 0) {
        return (
            <EmptyState
                title={t('debug.noTicks')}
                description={t('debug.ticksHint')}
                className="py-8"
            />
        );
    }

    const formatTime = (ms: number) => {
        if (ms === 0) return t('debug.never');
        const seconds = Math.floor((Date.now() - ms) / 1000);
        if (seconds < 1) return t('debug.justNow');
        if (seconds < 60) return t('debug.secondsAgo', { count: numberFormat.format(seconds) });
        return t('debug.minutesAgo', { count: numberFormat.format(Math.floor(seconds / 60)) });
    };

    const TickCard = ({ tick, active }: { tick: TickExecution; active: boolean }) => (
        <Card className={`p-3 ${!active ? 'opacity-50' : ''}`}>
            <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${active ? 'bg-success' : 'bg-muted-foreground'}`} />
                <Typography variant="body" weight="semibold" className="text-warning">
                    {tick.name}
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                    {tick.traitName}
                </Typography>
            </div>
            <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{t('debug.tickInterval', { count: numberFormat.format(tick.interval) })}</span>
                <span>{t(tick.runCount === 1 ? 'debug.tickRunOne' : 'debug.tickRunOther', { count: numberFormat.format(tick.runCount) })}</span>
                <span>{t('debug.tickExec', { count: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tick.executionTime) })}</span>
                <span>{formatTime(tick.lastRun)}</span>
            </div>
            {tick.guardName && (
                <div className="mt-2">
                    <Badge variant={tick.guardPassed ? 'success' : 'danger'} size="sm">
                        {tick.guardName}: {tick.guardPassed ? '✓' : '✗'}
                    </Badge>
                </div>
            )}
        </Card>
    );

    return (
        <div className="debug-tab debug-tab--ticks">
            {/* Active ticks */}
            {activeTicks.length > 0 && (
                <div className="mb-4">
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">
                        {t('debug.activeCount', { count: activeTicks.length })}
                    </Typography>
                    <Stack gap="sm">
                        {activeTicks.map(tick => (
                            <TickCard key={tick.id} tick={tick} active />
                        ))}
                    </Stack>
                </div>
            )}

            {/* Inactive ticks */}
            {inactiveTicks.length > 0 && (
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">
                        {t('debug.inactiveCount', { count: inactiveTicks.length })}
                    </Typography>
                    <Stack gap="sm">
                        {inactiveTicks.map(tick => (
                            <TickCard key={tick.id} tick={tick} active={false} />
                        ))}
                    </Stack>
                </div>
            )}
        </div>
    );
}

TicksTab.displayName = 'TicksTab';
