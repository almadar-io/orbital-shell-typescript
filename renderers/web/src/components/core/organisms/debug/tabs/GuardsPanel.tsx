'use client';
/**
 * GuardsPanel - Displays guard evaluation history
 * Uses existing component library atoms/molecules.
 */

import * as React from 'react';
import type { GuardEvaluation } from '../../../../../lib/guardRegistry';
import { Accordion } from '../../../molecules/Accordion';
import { Badge } from '../../../../../core';
import { Typography } from '../../../../../core';
import { Stack } from '../../../../../core';
import { ButtonGroup } from '../../../molecules/ButtonGroup';
import { Button } from '../../../../../core';
import { EmptyState } from '../../../molecules/EmptyState';
import { useTranslate } from '../../../../../core';

interface GuardsPanelProps {
    guards: GuardEvaluation[];
}

export function GuardsPanel({ guards }: GuardsPanelProps) {
    const { t, locale } = useTranslate();
    const [filter, setFilter] = React.useState<'all' | 'passed' | 'failed'>('all');

    if (guards.length === 0) {
        return (
            <EmptyState
                title={t('debug.noGuardEvaluations')}
                description={t('debug.guardEvaluationsHint')}
                className="py-8"
            />
        );
    }

    const passedCount = guards.filter(g => g.result).length;
    const failedCount = guards.length - passedCount;

    const filteredGuards = React.useMemo(() => {
        if (filter === 'all') return guards;
        if (filter === 'passed') return guards.filter(g => g.result);
        return guards.filter(g => !g.result);
    }, [guards, filter]);

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString(locale, {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    const accordionItems = filteredGuards.slice(-50).reverse().map(guard => ({
        id: guard.id,
        header: (
            <div className="flex items-center gap-2 w-full">
                <Badge variant={guard.result ? 'success' : 'danger'} size="sm">
                    {guard.result ? '✓' : '✗'}
                </Badge>
                <Typography variant="body" weight="semibold" className="text-warning">
                    {guard.guardName}
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                    {guard.context.type === 'transition'
                        ? `${guard.context.transitionFrom} → ${guard.context.transitionTo}`
                        : guard.context.tickName
                    }
                </Typography>
                <Typography variant="small" className="text-muted-foreground ml-auto">
                    {formatTime(guard.timestamp)}
                </Typography>
            </div>
        ),
        content: (
            <Stack gap="sm">
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground">{t('debug.expression')}</Typography>
                    <code className="block mt-1 text-xs text-foreground bg-warning/10 px-2 py-1 rounded">
                        {guard.expression}
                    </code>
                </div>
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground">{t('debug.inputs')}</Typography>
                    <pre className="mt-1 text-xs text-muted-foreground bg-muted p-2 rounded overflow-auto max-h-24">
                        {JSON.stringify(guard.inputs, null, 2)}
                    </pre>
                </div>
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground">{t('debug.trait')}</Typography>
                    <Typography variant="small">{guard.context.traitName}</Typography>
                </div>
            </Stack>
        ),
    }));

    return (
        <div className="debug-tab debug-tab--guards">
            {/* Stats and filters */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex gap-3">
                    <Badge variant="success" size="sm">✓ {passedCount}</Badge>
                    <Badge variant="danger" size="sm">✗ {failedCount}</Badge>
                </div>
                <ButtonGroup>
                    <Button size="sm" variant={filter === 'all' ? 'primary' : 'secondary'} onClick={() => setFilter('all')}>
                        {t('debug.filterAll')}
                    </Button>
                    <Button size="sm" variant={filter === 'passed' ? 'primary' : 'secondary'} onClick={() => setFilter('passed')}>
                        {t('debug.filterPassed')}
                    </Button>
                    <Button size="sm" variant={filter === 'failed' ? 'primary' : 'secondary'} onClick={() => setFilter('failed')}>
                        {t('debug.filterFailed')}
                    </Button>
                </ButtonGroup>
            </div>

            {/* Guard list */}
            <div className="max-h-80 overflow-y-auto">
                <Accordion items={accordionItems} />
            </div>
        </div>
    );
}

GuardsPanel.displayName = 'GuardsPanel';
