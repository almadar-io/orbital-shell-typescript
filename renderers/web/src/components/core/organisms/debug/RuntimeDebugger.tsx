'use client';
/**
 * RuntimeDebugger - Main debug panel for KFlow applications
 *
 * Press backtick (`) to toggle. Displays traits, ticks, entities, events,
 * guards, verification checks, transition timeline, and server bridge health.
 * Verify mode shows the followed trait's code beside its live state machine.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import type { A11yProps, DependencyGraph, OrbitalSchema } from '@almadar/core';
import { cn } from '../../../../core';
import { pressableProps } from '../../../../core';
import { domPassthrough, type DomPassthrough } from '../../../../core';
import type { TransitionTrace } from '../../../../lib/verificationRegistry';
import { useDebugData } from './hooks/useDebugData';
import { onDebugToggle, isDebugEnabled } from '../../../../lib/debugUtils';
import { Tabs, type TabItem } from '../../molecules/Tabs';
import { Button } from '../../../../core';
import { Card } from '../../../../core';
import { Badge } from '../../../../core';
import { Typography } from '../../../../core';
import { MachinePanel, type DescribeTrait } from './MachinePanel';
import { TraitsTab } from './tabs/TraitsTab';
import { TicksTab } from './tabs/TicksTab';
import { EntitiesTab } from './tabs/EntitiesTab';
import { EventFlowTab } from './tabs/EventFlowTab';
import { GuardsPanel } from './tabs/GuardsPanel';
import { VerificationTab } from './tabs/VerificationTab';
import { TransitionTimeline } from './tabs/TransitionTimeline';
import { ServerBridgeTab } from './tabs/ServerBridgeTab';
import { EventDispatcherTab } from './tabs/EventDispatcherTab';
import { useTranslate } from '../../../../core';
import './RuntimeDebugger.css';

/** The verify panel: a status bar over the followed trait's code beside its live state machine. */
function VerifyModePanel({
    className,
    a11y,
    failedChecks,
    transitions,
    traitStates,
    serverCount,
    localCount,
    schema,
    describe,
    behavior,
    dependencies,
}: {
    className?: string;
    a11y: DomPassthrough;
    failedChecks: number;
    transitions: TransitionTrace[];
    traitStates: string;
    serverCount: number;
    localCount: number;
    schema?: OrbitalSchema;
    describe?: DescribeTrait;
    behavior?: string;
    dependencies?: DependencyGraph;
}) {
    const { t } = useTranslate();
    // Expanded by default — verification screenshots otherwise reduce to a
    // collapsed strip with no diagnostic value. Click the status bar to
    // collapse if needed.
    const [expanded, setExpanded] = React.useState(true);
    // Render into a dedicated host portal so we sit below modals (z-40) and
    // don't obscure any overlay slots (modal=z-1000, drawer=z-900). ONLY
    // honor `#runtime-debugger-portal` (a host-provided container OUTSIDE
    // the slot system). The previous fallback to `#slot-hud-bottom` was
    // removed because UISlotRenderer's own `#slot-hud-bottom` is an
    // absolute-positioned child of the scrollable preview area — portalling
    // into it parents the debugger inside the (potentially-short) preview's
    // content height instead of pinning it to the viewport. When the host
    // doesn't provide `#runtime-debugger-portal`, fall through to the
    // viewport-fixed inline rendering (see the className branch below).
    const hudBottom = typeof document !== 'undefined'
      ? document.getElementById('runtime-debugger-portal')
      : null;

    const panel = (
        <div
            {...a11y}
            className={cn(
                'runtime-debugger runtime-debugger--verify',
                'flex flex-col bg-[var(--color-card)] text-[var(--color-foreground)] border-t-heavy border-accent',
                hudBottom ? '' : 'fixed bottom-0 left-0 right-0',
                className
            )}
            data-testid="debugger-verify"
            data-expanded={expanded ? 'true' : 'false'}
            style={{ height: expanded ? '40vh' : 'auto', zIndex: hudBottom ? undefined : 40 }}
        >
            {/* Status bar — always visible, clickable to toggle */}
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="px-3 py-1.5 flex items-center gap-3 text-xs font-mono border-b border-border flex-shrink-0 w-full text-left hover:bg-[var(--color-card-hover,transparent)] cursor-pointer"
                aria-expanded={expanded}
                aria-label={expanded ? t('debug.collapseVerificationTimeline') : t('debug.expandVerificationTimeline')}
                data-testid="debugger-verify-toggle"
            >
                <span className="text-muted-foreground w-3" aria-hidden>{expanded ? '▾' : '▸'}</span>
                <Badge variant={failedChecks > 0 ? 'danger' : 'success'} size="sm">
                    {failedChecks > 0 ? t('debug.failCount', { count: failedChecks }) : t('debug.ok')}
                </Badge>
                <span className="text-muted-foreground">
                    {t('debug.localCount', { count: localCount })}
                </span>
                <span className="text-primary">
                    {t('debug.serverCount', { count: serverCount })}
                </span>
                {traitStates && (
                    <span className="text-foreground truncate max-w-[400px]">{traitStates}</span>
                )}
                {!expanded && transitions.length > 0 && (
                    <span className="ml-auto text-muted-foreground">{t('debug.transitionsCount', { count: transitions.length })}</span>
                )}
            </button>

            {expanded && (
                <div className="flex-1 min-h-0 overflow-hidden">
                    {schema ? (
                        <MachinePanel schema={schema} transitions={transitions} describe={describe} behavior={behavior} dependencies={dependencies} />
                    ) : (
                        <div className="h-full overflow-y-auto px-2 py-1">
                            <TransitionTimeline transitions={transitions} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    return hudBottom ? createPortal(panel, hudBottom) : panel;
}

export interface RuntimeDebuggerProps extends Omit<React.AriaAttributes, keyof A11yProps>, A11yProps {
    /** Initial position */
    position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    /** Initial collapsed state */
    defaultCollapsed?: boolean;
    /** Additional CSS classes */
    className?: string;
    /** Display mode: floating (fixed overlay), inline (block element), or verify (always-visible compact overlay for verification runs) */
    mode?: 'floating' | 'inline' | 'verify';
    /** Default active tab id */
    defaultTab?: string;
    /** The running program: the dispatcher's payloads, and the machines the verify panel draws. */
    schema?: OrbitalSchema;
    /** Reads a trait's printed `.lolo` for the verify panel's code column. */
    describe?: DescribeTrait;
    /** The program's behavior, naming the traits it authors itself. */
    behavior?: string;
    /** The program's imports (`behavior/dependencies`): the layers the verify panel's flow places each unit in. */
    dependencies?: DependencyGraph;
}

export function RuntimeDebugger({
    position = 'bottom-right',
    defaultCollapsed = true,
    className,
    mode = 'floating',
    defaultTab,
    schema,
    describe,
    behavior,
    dependencies,
    ...rest
}: RuntimeDebuggerProps) {
    const a11y = domPassthrough(rest);
    const { t } = useTranslate();
    const [isCollapsed, setIsCollapsed] = React.useState(mode === 'verify' ? true : defaultCollapsed);
    const [isVisible, setIsVisible] = React.useState(mode === 'inline' || mode === 'verify' || isDebugEnabled());

    const debugData = useDebugData();

    // Listen for keyboard toggle (floating mode only)
    React.useEffect(() => {
        if (mode === 'inline') return;
        return onDebugToggle((enabled) => {
            setIsVisible(enabled);
            if (enabled) {
                setIsCollapsed(false);
            }
        });
    }, [mode]);

    // Keyboard shortcut to toggle collapse (floating mode only)
    React.useEffect(() => {
        if (mode === 'inline') return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === '`' && isVisible) {
                // Don't toggle if typing in input
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
                setIsCollapsed(prev => !prev);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isVisible, mode]);

    if (!isVisible) {
        return null;
    }

    const positionClasses = {
        'bottom-right': 'bottom-4 right-4',
        'bottom-left': 'bottom-4 left-4',
        'top-right': 'top-4 right-4',
        'top-left': 'top-4 left-4',
    };

    const { verification } = debugData;
    const failedChecks = verification.summary.failed;

    // Build tab items using existing Tabs molecule
    const tabItems: TabItem[] = [
        {
            id: 'dispatch',
            label: t('debug.tabDispatch'),
            badge: debugData.traits.length || undefined,
            content: <EventDispatcherTab traits={debugData.traits} schema={schema} />,
        },
        {
            id: 'verify',
            label: failedChecks > 0 ? t('debug.tabVerifyAlert') : t('debug.tabVerify'),
            badge: verification.summary.totalChecks || undefined,
            content: <VerificationTab checks={verification.checks} summary={verification.summary} />,
        },
        {
            id: 'timeline',
            label: t('debug.tabTimeline'),
            badge: verification.transitions.length || undefined,
            content: <TransitionTimeline transitions={verification.transitions} />,
        },
        {
            id: 'bridge',
            label: t('debug.tabBridge'),
            badge: verification.bridge?.connected ? undefined : 1,
            content: <ServerBridgeTab bridge={verification.bridge} />,
        },
        {
            id: 'traits',
            label: t('debug.tabTraits'),
            badge: debugData.traits.length || undefined,
            content: <TraitsTab traits={debugData.traits} />,
        },
        {
            id: 'ticks',
            label: t('debug.tabTicks'),
            badge: debugData.ticks.filter((tick: { active: boolean }) => tick.active).length || undefined,
            content: <TicksTab ticks={debugData.ticks} />,
        },
        {
            id: 'entities',
            label: t('debug.tabEntities'),
            badge: debugData.entitySnapshot?.runtime.length || undefined,
            content: <EntitiesTab snapshot={debugData.entitySnapshot} />,
        },
        {
            id: 'events',
            label: t('debug.tabEvents'),
            badge: debugData.events.length > 0 ? debugData.events.length : undefined,
            content: <EventFlowTab events={debugData.events} />,
        },
        {
            id: 'guards',
            label: t('debug.tabGuards'),
            badge: debugData.guards.filter((g: { result: boolean }) => !g.result).length || undefined,
            content: <GuardsPanel guards={debugData.guards} />,
        },
    ];

    // Inline mode: collapsible, no fixed positioning
    if (mode === 'inline') {
        return (
            <div
                {...a11y}
                className={cn(
                    'runtime-debugger',
                    'runtime-debugger--inline',
                    className
                )}
                data-testid="debugger-inline"
            >
                <Card className={cn(
                    'runtime-debugger__panel',
                    isCollapsed ? 'runtime-debugger__panel--inline-collapsed' : 'runtime-debugger__panel--inline',
                )}>
                    {/* Header - always visible, acts as toggle */}
                    <div
                        className="runtime-debugger__header"
                        {...pressableProps(() => setIsCollapsed(prev => !prev))}
                        aria-expanded={!isCollapsed}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                        <div className="flex items-center gap-2">
                            <Typography variant="h6" style={{ fontSize: '0.75rem' }}>
                                {isCollapsed ? '\u25B6' : '\u25BC'} {t('debug.debugger')}
                            </Typography>
                            {failedChecks > 0 ? (
                                <Badge variant="danger" size="sm">{t('debug.failedCount', { count: failedChecks })}</Badge>
                            ) : debugData.traits.length > 0 ? (
                                <Badge variant="success" size="sm">{t('debug.traitsCount', { count: debugData.traits.length })}</Badge>
                            ) : (
                                <Badge variant="info" size="sm">{t('debug.idle')}</Badge>
                            )}
                        </div>
                    </div>

                    {/* Tabs - only visible when expanded */}
                    {!isCollapsed && (
                        <div className="runtime-debugger__content">
                            <Tabs
                                items={tabItems}
                                defaultActiveTab={defaultTab}
                                variant="pills"
                                className="runtime-debugger__tabs"
                            />
                        </div>
                    )}
                </Card>
            </div>
        );
    }

    // Verify mode: always-visible panel at bottom showing full interaction timeline
    if (mode === 'verify') {
        const traitStates = debugData.traits.map((t: { name: string; currentState: string }) => `${t.name}:${t.currentState}`).join(' | ');
        const serverEntries = verification.transitions.filter((t) => t.serverResponse);
        const localEntries = verification.transitions.filter((t) => !t.serverResponse);

        return (
            <VerifyModePanel
                a11y={a11y}
                className={className}
                failedChecks={failedChecks}
                transitions={verification.transitions}
                traitStates={traitStates}
                serverCount={serverEntries.length}
                localCount={localEntries.length}
                schema={schema}
                describe={describe}
                behavior={behavior}
                dependencies={dependencies}
            />
        );
    }

    // Floating mode: fixed position overlay with collapse/expand
    return (
        <div
            {...a11y}
            className={cn(
                'runtime-debugger',
                'fixed',
                positionClasses[position],
                isCollapsed ? 'runtime-debugger--collapsed' : 'runtime-debugger--expanded',
                className
            )}
            data-testid={isCollapsed ? 'debugger-collapsed' : 'debugger-expanded'}
            style={{ zIndex: 99999 }}
        >
            {isCollapsed ? (
                <Button
                    onClick={() => setIsCollapsed(false)}
                    variant="secondary"
                    size="sm"
                    className="runtime-debugger__toggle"
                    title={t('debug.openDebugger')}
                >
                    {failedChecks > 0 ? (
                        <span className="relative">
                            <span>V</span>
                            <span className="absolute -top-1 -right-2 w-2 h-2 bg-error rounded-full" />
                        </span>
                    ) : (
                        <span>V</span>
                    )}
                </Button>
            ) : (
                <Card className="runtime-debugger__panel">
                    {/* Header */}
                    <div className="runtime-debugger__header">
                        <div className="flex items-center gap-2">
                            <span className="text-lg">V</span>
                            <Typography variant="h6">{t('debug.kflowVerifier')}</Typography>
                            {failedChecks > 0 ? (
                                <Badge variant="danger" size="sm">{t('debug.failedCount', { count: failedChecks })}</Badge>
                            ) : verification.summary.totalChecks > 0 ? (
                                <Badge variant="success" size="sm">{t('debug.allPassing')}</Badge>
                            ) : (
                                <Badge variant="info" size="sm">{t('debug.runtime')}</Badge>
                            )}
                        </div>
                        <Button
                            onClick={() => setIsCollapsed(true)}
                            variant="ghost"
                            size="sm"
                            icon="x"
                            title={t('debug.close')}
                            aria-label={t('debug.close')}
                        />
                    </div>

                    {/* Tabs - using existing Tabs molecule */}
                    <div className="runtime-debugger__content">
                        <Tabs
                            items={tabItems}
                            defaultActiveTab={defaultTab}
                            variant="pills"
                            className="runtime-debugger__tabs"
                        />
                    </div>

                    {/* Footer */}
                    <div className="runtime-debugger__footer">
                        <Typography variant="small" className="text-muted-foreground">
                            {t('debug.toggleHint')}
                        </Typography>
                    </div>
                </Card>
            )}
        </div>
    );
}

RuntimeDebugger.displayName = 'RuntimeDebugger';
