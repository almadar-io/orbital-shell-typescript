/**
 * EntitiesTab - Displays entity snapshots
 * Uses existing component library atoms/molecules.
 */

import * as React from 'react';
import type { EntitySnapshot } from '../../../../../lib/entityDebug';
import { Accordion } from '../../../molecules/Accordion';
import { Badge } from '../../../../../core';
import { Typography } from '../../../../../core';
import { Stack } from '../../../../../core';
import { EmptyState } from '../../../molecules/EmptyState';
import { useTranslate } from '../../../../../core';

interface EntitiesTabProps {
    snapshot: EntitySnapshot | null;
}

export function EntitiesTab({ snapshot }: EntitiesTabProps) {
    const { t } = useTranslate();
    if (!snapshot) {
        return (
            <EmptyState
                title={t('debug.noEntityData')}
                description={t('debug.debugModeHint')}
                className="py-8"
            />
        );
    }

    const singletonEntries = Object.entries(snapshot.singletons);
    const runtimeEntities = snapshot.runtime;
    const persistentEntries = Object.entries(snapshot.persistent);

    if (singletonEntries.length === 0 && runtimeEntities.length === 0 && persistentEntries.length === 0) {
        return (
            <EmptyState
                title={t('debug.noEntities')}
                description={t('debug.entitiesSpawnHint')}
                className="py-8"
            />
        );
    }

    // Build accordion items for singletons
    const singletonItems = singletonEntries.map(([name, data]) => ({
        id: `singleton-${name}`,
        header: (
            <div className="flex items-center gap-2">
                <Badge variant="primary" size="sm">{t('debug.singleton')}</Badge>
                <Typography variant="body" weight="semibold" className="text-info">
                    {name}
                </Typography>
            </div>
        ),
        content: (
            <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-auto max-h-40">
                {JSON.stringify(data, null, 2)}
            </pre>
        ),
    }));

    // Build accordion items for runtime entities (limit to 20)
    const runtimeItems = runtimeEntities.slice(0, 20).map(entity => ({
        id: entity.id,
        header: (
            <div className="flex items-center gap-2">
                <Typography variant="body" weight="semibold" className="text-info">
                    {entity.type}
                </Typography>
                <Typography variant="small" className="text-muted-foreground">
                    #{entity.id.slice(0, 8)}
                </Typography>
            </div>
        ),
        content: (
            <pre className="text-xs text-muted-foreground bg-muted p-2 rounded overflow-auto max-h-40">
                {JSON.stringify(entity.data, null, 2)}
            </pre>
        ),
    }));

    return (
        <div className="debug-tab debug-tab--entities">
            {/* Singletons */}
            {singletonItems.length > 0 && (
                <div className="mb-4">
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">
                        {t('debug.singletonsCount', { count: singletonItems.length })}
                    </Typography>
                    <Accordion items={singletonItems} multiple />
                </div>
            )}

            {/* Runtime entities */}
            {runtimeItems.length > 0 && (
                <div className="mb-4">
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">
                        {t('debug.runtimeCount', { count: runtimeEntities.length })}
                    </Typography>
                    <Accordion items={runtimeItems} multiple />
                    {runtimeEntities.length > 20 && (
                        <Typography variant="small" className="text-muted-foreground text-center mt-2">
                            {t('debug.moreEntities', { count: runtimeEntities.length - 20 })}
                        </Typography>
                    )}
                </div>
            )}

            {/* Persistent entities */}
            {persistentEntries.length > 0 && (
                <div>
                    <Typography variant="small" weight="medium" className="text-muted-foreground mb-2">
                        {t('debug.persistent')}
                    </Typography>
                    <Stack gap="xs">
                        {persistentEntries.map(([type, info]) => (
                            <div key={type} className="flex items-center justify-between py-1">
                                <Typography variant="small">{type}</Typography>
                                <Badge variant={info.loaded ? 'success' : 'default'} size="sm">
                                    {info.loaded ? t('debug.loadedCount', { count: info.count }) : t('debug.notLoaded')}
                                </Badge>
                            </div>
                        ))}
                    </Stack>
                </div>
            )}
        </div>
    );
}

EntitiesTab.displayName = 'EntitiesTab';
