/**
 * TraitsTab - Displays active traits and their state machines
 * Uses existing component library atoms/molecules.
 */

import * as React from 'react';
import type { TraitDebugInfo } from '../../../../../lib/traitRegistry';
import { Accordion } from '../../../molecules/Accordion';
import { Badge } from '../../../../../core';
import { Typography } from '../../../../../core';
import { Stack } from '../../../../../core';
import { EmptyState } from '../../../molecules/EmptyState';
import { useTranslate } from '../../../../../core';

interface TraitsTabProps {
    traits: TraitDebugInfo[];
}

export function TraitsTab({ traits }: TraitsTabProps) {
    const { t } = useTranslate();
    if (traits.length === 0) {
        return (
            <EmptyState
                title={t('debug.noActiveTraits')}
                description={t('debug.traitsMountHint')}
                className="py-8"
            />
        );
    }

    const accordionItems = traits.map(trait => ({
        id: trait.id,
        header: (
            <div className="flex items-center gap-2 w-full">
                <Typography variant="body" weight="semibold" className="text-primary">
                    {trait.name}
                </Typography>
                <Badge variant="success" size="sm">{trait.currentState}</Badge>
                <Typography variant="small" className="text-muted-foreground ml-auto">
                    {t('debug.transitionsCount', { count: trait.transitionCount })}
                </Typography>
            </div>
        ),
        content: (
            <Stack gap="sm">
                {/* States */}
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">{t('debug.states')}</Typography>
                    <div className="flex flex-wrap gap-1">
                        {trait.states.map(state => (
                            <Badge
                                key={state}
                                variant={state === trait.currentState ? 'success' : 'default'}
                                size="sm"
                            >
                                {state}
                            </Badge>
                        ))}
                    </div>
                </div>

                {/* Transitions */}
                {trait.transitions.length > 0 && (
                    <div>
                        <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">{t('debug.transitions')}</Typography>
                        <Stack gap="xs">
                            {trait.transitions.map((t, i) => (
                                <Typography key={i} variant="small" className="font-mono">
                                    {t.from} → {t.to} <span className="text-muted-foreground">({t.event})</span>
                                    {t.guard && <span className="text-warning"> [{t.guard}]</span>}
                                </Typography>
                            ))}
                        </Stack>
                    </div>
                )}

                {/* Guards */}
                {trait.guards.length > 0 && (
                    <div>
                        <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">{t('debug.guards')}</Typography>
                        <Stack gap="xs">
                            {trait.guards.map((g, i) => (
                                <div key={i} className="flex items-center justify-between">
                                    <Typography variant="small">{g.name}</Typography>
                                    <Badge variant={g.lastResult === true ? 'success' : g.lastResult === false ? 'danger' : 'default'} size="sm">
                                        {g.lastResult === undefined ? '?' : g.lastResult ? '✓' : '✗'}
                                    </Badge>
                                </div>
                            ))}
                        </Stack>
                    </div>
                )}
            </Stack>
        ),
    }));

    return (
        <div className="debug-tab debug-tab--traits">
            <Accordion items={accordionItems} multiple />
        </div>
    );
}

TraitsTab.displayName = 'TraitsTab';
