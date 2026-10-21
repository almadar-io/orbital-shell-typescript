'use client';
/**
 * VersionDiff Molecule
 *
 * Side-by-side or inline line diff. Two inputs: `revisions` (whole texts,
 * with before/after pickers and a minimal LCS diff) or `hunks` (a
 * pre-computed diff, e.g. one git commit, rendered as-is).
 */

import React, { useState, useMemo, useCallback, useEffect } from "react";
import type { A11yProps, EventPayloadValue, EventEmit } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Card, Typography, Button, Badge, Icon, Box, Select } from '../../../core';
import { VStack, HStack } from '../../../core';
import { computeLineDiff } from "../../../lib/lineDiff";
import { domPassthrough } from '../../../core';

export interface DiffRevision {
    id: string;
    label: string;
    author?: string;
    timestamp?: string;
    content: string;
}

export type DiffLineType = "added" | "removed" | "unchanged" | "context";

export interface DiffLine {
    type: DiffLineType;
    beforeLineNumber?: number;
    afterLineNumber?: number;
    content: string;
}

export type VersionDiffView = "side-by-side" | "inline";

/** One hunk of a pre-computed diff: its header (e.g. `@@ -1,2 +1,2 @@ file`) and lines. */
export interface DiffHunk {
    header: string;
    lines: readonly DiffLine[];
}

/**
 * A line diff between two versions — two whole texts, or a pre-computed diff such as one commit.
 *
 * @capabilities version diff, compare revisions, what changed, before and after, code diff, commit diff, revision comparison
 */
export interface VersionDiffProps extends A11yProps {
    /**
     * All available revisions (at least 2). Accepts either a typed array (direct
     * consumers) or the runtime payload shape from a render-ui binding
     * (`@payload.revisions`). Narrowed to `[]` internally when the value isn't
     * an array.
     */
    revisions?: readonly DiffRevision[] | EventPayloadValue;
    /** A pre-computed diff to render instead of diffing `revisions` (no revision pickers). */
    hunks?: readonly DiffHunk[];
    /** Currently selected "before" revision id. */
    beforeId?: string;
    /** Currently selected "after" revision id. */
    afterId?: string;
    /** Display mode to start in; the toggle switches it. */
    view?: VersionDiffView;
    /** Called when the user picks a different "before" revision. */
    onSelectBefore?: (id: string) => void;
    /** Called when the user picks a different "after" revision. */
    onSelectAfter?: (id: string) => void;
    /** Called when the user clicks the revert button (passes the "before" id). */
    onRevert?: (id: string) => void;
    /** Event name dispatched via event bus when the "before" revision changes. Payload: { id }. */
    selectBeforeEvent?: EventEmit<{ id: string }>;
    /** Event name dispatched via event bus when the "after" revision changes. Payload: { id }. */
    selectAfterEvent?: EventEmit<{ id: string }>;
    /** Event name dispatched via event bus when the user clicks revert. Payload: { id }. */
    revertEvent?: EventEmit<{ id: string }>;
    /** Language label (informational). */
    language?: string;
    /** Additional CSS classes. */
    className?: string;
}

function isDiffRevision(value: DiffRevision | EventPayloadValue): value is DiffRevision {
    return (
        typeof value === "object" && value !== null && !Array.isArray(value) &&
        "id" in value && typeof value.id === "string" &&
        "label" in value && typeof value.label === "string" &&
        "content" in value && typeof value.content === "string"
    );
}

function toRevisions(value: readonly DiffRevision[] | EventPayloadValue | undefined): readonly DiffRevision[] {
    if (!Array.isArray(value)) return [];
    const out: DiffRevision[] = [];
    for (const item of value) if (isDiffRevision(item)) out.push(item);
    return out;
}

const firstValue = (v: string | string[]): string => (typeof v === "string" ? v : v[0] ?? "");

type DiffRow =
    | { kind: "header"; header: string }
    | { kind: "line"; line: DiffLine }
    | { kind: "gap"; id: number; count: number };

/** Unchanged lines kept on each side of a change; a run hiding fewer than MIN_HIDDEN lines stays open. */
const CONTEXT_LINES = 3;
const MIN_HIDDEN = 4;

/**
 * Long runs of unchanged lines become one "N unchanged lines" row (its id: the first hidden row's
 * index), keeping CONTEXT_LINES next to each change. Lines a caller marked `context` are kept.
 */
function collapseUnchanged(rows: readonly DiffRow[], expanded: ReadonlySet<number>): DiffRow[] {
    const isUnchanged = (row: DiffRow | undefined): boolean => row?.kind === "line" && row.line.type === "unchanged";
    const out: DiffRow[] = [];
    let i = 0;
    while (i < rows.length) {
        if (!isUnchanged(rows[i])) {
            out.push(rows[i]);
            i++;
            continue;
        }
        let j = i;
        while (j < rows.length && isUnchanged(rows[j])) j++;
        const keepHead = rows[i - 1]?.kind === "line" ? CONTEXT_LINES : 0;
        const keepTail = rows[j]?.kind === "line" ? CONTEXT_LINES : 0;
        const hidden = j - i - keepHead - keepTail;
        const id = i + keepHead;
        if (hidden < MIN_HIDDEN || expanded.has(id)) {
            out.push(...rows.slice(i, j));
        } else {
            out.push(...rows.slice(i, i + keepHead), { kind: "gap", id, count: hidden }, ...rows.slice(j - keepTail, j));
        }
        i = j;
    }
    return out;
}

const INLINE_STYLES: Record<DiffLineType, { bg: string; prefix: string; text: string }> = {
    added: { bg: "bg-success/10", prefix: "+", text: "text-success" },
    removed: { bg: "bg-error/10", prefix: "-", text: "text-error" },
    unchanged: { bg: "", prefix: " ", text: "text-foreground" },
    context: { bg: "", prefix: " ", text: "text-muted-foreground" },
};

const VersionDiffInner: React.FC<VersionDiffProps> = ({
    revisions: revisionsProp,
    hunks,
    beforeId,
    afterId,
    view = "side-by-side",
    onSelectBefore,
    onSelectAfter,
    onRevert,
    selectBeforeEvent,
    selectAfterEvent,
    revertEvent,
    language,
    className,
    ...rest
}) => {
    const { t } = useTranslate();
    const eventBus = useEventBus();
    const revisions = useMemo(() => toRevisions(revisionsProp), [revisionsProp]);
    const fallbackBefore = revisions[0]?.id ?? "";
    const fallbackAfter = revisions[1]?.id ?? revisions[0]?.id ?? "";

    const [internalBefore, setInternalBefore] = useState<string>(beforeId ?? fallbackBefore);
    const [internalAfter, setInternalAfter] = useState<string>(afterId ?? fallbackAfter);
    const [activeView, setActiveView] = useState<VersionDiffView>(view);
    useEffect(() => setActiveView(view), [view]);

    const activeBeforeId = beforeId ?? internalBefore;
    const activeAfterId = afterId ?? internalAfter;

    const beforeRev = useMemo(
        () => revisions.find((r) => r.id === activeBeforeId) ?? revisions[0],
        [revisions, activeBeforeId],
    );
    const afterRev = useMemo(
        () => revisions.find((r) => r.id === activeAfterId) ?? revisions[1] ?? revisions[0],
        [revisions, activeAfterId],
    );

    const rows = useMemo<readonly DiffRow[]>(() => {
        if (hunks) {
            return hunks.flatMap((h): DiffRow[] => [
                { kind: "header", header: h.header },
                ...h.lines.map((line): DiffRow => ({ kind: "line", line })),
            ]);
        }
        return computeLineDiff(beforeRev?.content ?? "", afterRev?.content ?? "").map((line): DiffRow => ({ kind: "line", line }));
    }, [hunks, beforeRev, afterRev]);

    const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());
    useEffect(() => setExpanded(new Set()), [rows]);
    const shown = useMemo(() => collapseUnchanged(rows, expanded), [rows, expanded]);

    const stats = useMemo(() => {
        let added = 0;
        let removed = 0;
        for (const row of rows) {
            if (row.kind !== "line") continue;
            if (row.line.type === "added") added++;
            else if (row.line.type === "removed") removed++;
        }
        return { added, removed };
    }, [rows]);

    const handleBeforeChange = useCallback(
        (v: string | string[]) => {
            const id = firstValue(v);
            setInternalBefore(id);
            onSelectBefore?.(id);
            if (selectBeforeEvent) eventBus.emit(`UI:${selectBeforeEvent}`, { id });
        },
        [onSelectBefore, selectBeforeEvent, eventBus],
    );

    const handleAfterChange = useCallback(
        (v: string | string[]) => {
            const id = firstValue(v);
            setInternalAfter(id);
            onSelectAfter?.(id);
            if (selectAfterEvent) eventBus.emit(`UI:${selectAfterEvent}`, { id });
        },
        [onSelectAfter, selectAfterEvent, eventBus],
    );

    const handleViewToggle = useCallback(() => {
        setActiveView((v) => (v === "side-by-side" ? "inline" : "side-by-side"));
    }, []);

    const handleRevert = useCallback(() => {
        if (beforeRev) {
            onRevert?.(beforeRev.id);
            if (revertEvent) eventBus.emit(`UI:${revertEvent}`, { id: beforeRev.id });
        }
    }, [beforeRev, onRevert, revertEvent, eventBus]);

    const options = useMemo(
        () => revisions.map((r) => ({ value: r.id, label: r.label })),
        [revisions],
    );

    const renderHeader = (header: string, key: string) => (
        <Box key={key} className="px-3 py-1 bg-info/10 border-y border-border">
            <Typography variant="caption" className="font-mono text-info">{header}</Typography>
        </Box>
    );

    const renderGap = (row: { id: number; count: number }, key: string) => (
        <Button
            key={key}
            variant="ghost"
            size="sm"
            icon="chevrons-up-down"
            data-testid="version-diff-gap"
            className="w-full justify-start rounded-none bg-muted/40 text-muted-foreground"
            onClick={() => setExpanded((open) => new Set(open).add(row.id))}
        >
            {t("versionDiff.unchangedLines", { count: row.count })}
        </Button>
    );

    const renderColumn = (side: "before" | "after") => (
        <VStack gap="none" className="font-mono text-xs">
            {shown.map((row, idx) => {
                if (row.kind === "header") return renderHeader(row.header, `${side}-h-${idx}`);
                if (row.kind === "gap") return renderGap(row, `${side}-g-${row.id}`);
                const { line } = row;
                const hidden = side === "before" ? line.type === "added" : line.type === "removed";
                if (hidden) return null;
                const changed = side === "before" ? line.type === "removed" : line.type === "added";
                return (
                    <HStack
                        key={`${side}-${idx}`}
                        gap="none"
                        align="start"
                        className={cn("px-3 py-0.5", changed && (side === "before" ? "bg-error/10" : "bg-success/10"))}
                    >
                        <Typography
                            variant="caption"
                            color="secondary"
                            className="w-8 text-right mr-3 select-none tabular-nums flex-shrink-0"
                        >
                            {(side === "before" ? line.beforeLineNumber : line.afterLineNumber) ?? ""}
                        </Typography>
                        <Typography
                            variant="caption"
                            className={cn(
                                "font-mono flex-1 min-w-0 whitespace-pre",
                                changed ? (side === "before" ? "text-error" : "text-success") : "text-foreground",
                            )}
                        >
                            {line.content || " "}
                        </Typography>
                    </HStack>
                );
            })}
        </VStack>
    );

    const isEmpty = hunks !== undefined && hunks.length === 0;

    return (
        <Card {...domPassthrough(rest)} className={cn("overflow-hidden", className)}>
            <VStack gap="none">
                <HStack
                    gap="sm"
                    align="center"
                    justify="between"
                    className="px-4 py-2 border-b border-border bg-muted/30 flex-wrap"
                >
                    <HStack gap="sm" align="center" className="flex-wrap">
                        <Icon name="git-commit" size="sm" className="text-muted-foreground" />
                        {!hunks && (
                            <>
                                <Typography variant="small" weight="medium" className="whitespace-nowrap">
                                    {t('versionDiff.compare')}
                                </Typography>
                                <Box className="min-w-0 md:min-w-[160px]">
                                    <Select
                                        options={options}
                                        value={activeBeforeId}
                                        onValueChange={handleBeforeChange}
                                        aria-label={t('versionDiff.beforeRevision')}
                                    />
                                </Box>
                                <Typography variant="caption" color="secondary">
                                    {t('versionDiff.to')}
                                </Typography>
                                <Box className="min-w-0 md:min-w-[160px]">
                                    <Select
                                        options={options}
                                        value={activeAfterId}
                                        onValueChange={handleAfterChange}
                                        aria-label={t('versionDiff.afterRevision')}
                                    />
                                </Box>
                            </>
                        )}
                        {language && <Badge variant="default">{language}</Badge>}
                        <Badge variant="success">+{stats.added}</Badge>
                        <Badge variant="error">-{stats.removed}</Badge>
                    </HStack>

                    <HStack gap="xs" align="center">
                        <Button
                            variant="ghost"
                            size="sm"
                            icon={activeView === "side-by-side" ? "align-left" : "columns"}
                            onClick={handleViewToggle}
                            aria-label={
                                activeView === "side-by-side"
                                    ? t('versionDiff.switchToInline')
                                    : t('versionDiff.switchToSideBySide')
                            }
                        />
                        {!hunks && (onRevert || revertEvent) && (
                            <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={handleRevert}>
                                {t('versionDiff.revert')}
                            </Button>
                        )}
                    </HStack>
                </HStack>

                {!hunks && (beforeRev?.author || beforeRev?.timestamp || afterRev?.author || afterRev?.timestamp) && (
                    <HStack
                        gap="sm"
                        align="center"
                        justify="between"
                        className="px-4 py-1 border-b border-border bg-muted/10"
                    >
                        <Typography variant="caption" color="secondary" className="truncate">
                            {beforeRev?.label}
                            {beforeRev?.author ? t('versionDiff.byAuthor', { author: beforeRev.author }) : ""}
                            {beforeRev?.timestamp ? ` (${beforeRev.timestamp})` : ""}
                        </Typography>
                        <Typography variant="caption" color="secondary" className="truncate">
                            {afterRev?.label}
                            {afterRev?.author ? t('versionDiff.byAuthor', { author: afterRev.author }) : ""}
                            {afterRev?.timestamp ? ` (${afterRev.timestamp})` : ""}
                        </Typography>
                    </HStack>
                )}

                <Box className="overflow-auto bg-muted/20" style={{ maxHeight: 600 }} role="region" tabIndex={0} aria-label={t('versionDiff.changes')}>
                    {isEmpty ? (
                        <Box className="py-8" data-testid="version-diff-empty">
                            <Typography variant="body2" color="muted" align="center">
                                {t('versionDiff.noChanges')}
                            </Typography>
                        </Box>
                    ) : activeView === "side-by-side" ? (
                        <Box className="grid grid-cols-1 md:grid-cols-2">
                            {/* Below md the columns stack, so the separator flips from right-edge to bottom-edge. */}
                            <Box className="min-w-0 overflow-x-auto border-b md:border-b-0 md:border-r border-border" data-testid="version-diff-before">
                                {renderColumn("before")}
                            </Box>
                            <Box className="min-w-0 overflow-x-auto" data-testid="version-diff-after">{renderColumn("after")}</Box>
                        </Box>
                    ) : (
                        <VStack gap="none" className="font-mono text-xs">
                            {shown.map((row, idx) => {
                                if (row.kind === "header") return renderHeader(row.header, `i-h-${idx}`);
                                if (row.kind === "gap") return renderGap(row, `i-g-${row.id}`);
                                const { line } = row;
                                const style = INLINE_STYLES[line.type];
                                return (
                                    <HStack key={`i-${idx}`} gap="none" align="start" className={cn("px-4 py-0.5", style.bg)}>
                                        <Typography
                                            variant="caption"
                                            color="secondary"
                                            className="w-8 text-right mr-2 select-none tabular-nums flex-shrink-0"
                                        >
                                            {line.beforeLineNumber ?? ""}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            color="secondary"
                                            className="w-8 text-right mr-3 select-none tabular-nums flex-shrink-0"
                                        >
                                            {line.afterLineNumber ?? ""}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            className={cn("font-mono flex-1 min-w-0 whitespace-pre", style.text)}
                                        >
                                            <Box as="span" className="select-none opacity-50 mr-2">
                                                {style.prefix}
                                            </Box>
                                            {line.content || " "}
                                        </Typography>
                                    </HStack>
                                );
                            })}
                        </VStack>
                    )}
                </Box>
            </VStack>
        </Card>
    );
};

export const VersionDiff = React.memo(VersionDiffInner);
VersionDiff.displayName = "VersionDiff";
