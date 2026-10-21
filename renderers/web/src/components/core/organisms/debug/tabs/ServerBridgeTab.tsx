'use client';
/**
 * ServerBridgeTab - Displays ServerBridge health and connectivity status
 *
 * Shows:
 * - Connection status (connected/disconnected)
 * - Events forwarded (client → server) count
 * - Events received (server → client) count
 * - Last error if any
 * - Last heartbeat timestamp
 */

import * as React from 'react';
import type { BridgeHealth } from '../../../../../lib/verificationRegistry';
import { Badge } from '../../../../../core';
import { Typography } from '../../../../../core';
import { Stack } from '../../../../../core';
import { Card } from '../../../../../core';
import { EmptyState } from '../../../molecules/EmptyState';
import { useTranslate } from '../../../../../core';

interface ServerBridgeTabProps {
    bridge: BridgeHealth | null;
}

function StatRow({ label, value, variant }: {
    label: string;
    value: string | number;
    variant?: 'success' | 'danger' | 'warning' | 'default';
}) {
    return (
        <div className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0">
            <Typography variant="small" className="text-muted-foreground">
                {label}
            </Typography>
            {variant ? (
                <Badge variant={variant} size="sm">{String(value)}</Badge>
            ) : (
                <Typography variant="small" weight="semibold" className="font-mono">
                    {String(value)}
                </Typography>
            )}
        </div>
    );
}

export function ServerBridgeTab({ bridge }: ServerBridgeTabProps) {
    const { t, locale } = useTranslate();
    if (!bridge) {
        return (
            <EmptyState
                title={t('debug.noBridgeData')}
                description={t('debug.bridgeInitHint')}
                className="py-8"
            />
        );
    }

    const formatTime = (ts: number) => {
        if (ts === 0) return t('debug.never');
        const d = new Date(ts);
        return d.toLocaleTimeString(locale, {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    return (
        <div className="debug-tab debug-tab--bridge">
            <Stack gap="sm">
                {/* Connection Status */}
                <Card className="p-3">
                    <div className="flex items-center gap-3 mb-3">
                        <div className={`w-3 h-3 rounded-full ${bridge.connected ? 'bg-success animate-pulse' : 'bg-error'}`} />
                        <Typography variant="h6">
                            {bridge.connected ? t('debug.connected') : t('debug.disconnected')}
                        </Typography>
                    </div>

                    <Stack gap="xs">
                        <StatRow
                            label={t('debug.status')}
                            value={bridge.connected ? t('debug.connected') : t('debug.disconnected')}
                            variant={bridge.connected ? 'success' : 'danger'}
                        />
                        <StatRow
                            label={t('debug.eventsForwarded')}
                            value={bridge.eventsForwarded}
                        />
                        <StatRow
                            label={t('debug.eventsReceived')}
                            value={bridge.eventsReceived}
                        />
                        <StatRow
                            label={t('debug.lastHeartbeat')}
                            value={formatTime(bridge.lastHeartbeat)}
                        />
                    </Stack>
                </Card>

                {/* Error Display */}
                {bridge.lastError && (
                    <Card className="p-3 border-error/30 bg-error/10">
                        <Typography variant="small" weight="semibold" className="text-error mb-1">
                            {t('debug.lastError')}
                        </Typography>
                        <Typography variant="small" className="text-error font-mono break-all">
                            {bridge.lastError}
                        </Typography>
                    </Card>
                )}

                {/* Throughput indicator */}
                {bridge.connected && (
                    <div className="text-center py-2">
                        <Typography variant="small" className="text-muted-foreground">
                            {t('debug.totalEventsProcessed', { count: bridge.eventsForwarded + bridge.eventsReceived })}
                        </Typography>
                    </div>
                )}
            </Stack>
        </div>
    );
}

ServerBridgeTab.displayName = 'ServerBridgeTab';
