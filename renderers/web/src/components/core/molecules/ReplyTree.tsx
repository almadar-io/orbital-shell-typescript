'use client';
/**
 * ReplyTree Organism Component
 *
 * Recursive nested-thread reply renderer with collapse, per-node mod actions, and vote.
 * Composes the VoteStack molecule + Avatar/Typography/Button atoms.
 */

import React, { useCallback, useState } from "react";
import type { EventEmit, EntityRow, EntityWith, A11yProps } from "@almadar/core";
import { cn } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { Avatar, Typography, Button, Box, Input } from '../../../core';
import { VoteStack, type VoteValue } from "./VoteStack";

import { domPassthrough } from '../../../core';
/** The per-node entity fields this tree reads. `replies` is the same row shape
 *  nested recursively; `userVote` carries the `VoteValue` literal union. */
export interface ReplyNodeRow {
    authorName: string;
    content: string;
    authorAvatarUrl?: string;
    postedAt?: string;
    voteCount?: number;
    userVote?: VoteValue;
    collapsed?: boolean;
    replies?: readonly EntityWith<ReplyNodeRow>[];
}

export interface ReplyTreeProps extends A11yProps {
    nodes: readonly EntityWith<ReplyNodeRow>[];
    maxDepth?: number;
    onVote?: (nodeId: string, vote: VoteValue) => void;
    onReply?: (parentNodeId: string) => void;
    onFlag?: (nodeId: string) => void;
    onContinueThread?: (nodeId: string) => void;
    voteEvent?: EventEmit<{ nodeId: string; vote: VoteValue }>;
    replyEvent?: EventEmit<{ parentNodeId: string; content: string }>;
    flagEvent?: EventEmit<{ nodeId: string }>;
    continueThreadEvent?: EventEmit<{ nodeId: string }>;
    showActions?: boolean;
    className?: string;
}

interface ReplyTreeNodeProps {
    node: EntityRow;
    depth: number;
    maxDepth: number;
    collapsedSet: Set<string>;
    toggleCollapse: (id: string) => void;
    onVote?: (nodeId: string, vote: VoteValue) => void;
    onReply?: (parentNodeId: string) => void;
    onFlag?: (nodeId: string) => void;
    onContinueThread?: (nodeId: string) => void;
    voteEvent?: EventEmit<{ nodeId: string; vote: VoteValue }>;
    replyEvent?: EventEmit<{ parentNodeId: string; content: string }>;
    flagEvent?: EventEmit<{ nodeId: string }>;
    continueThreadEvent?: EventEmit<{ nodeId: string }>;
    showActions: boolean;
}

const ReplyTreeNode: React.FC<ReplyTreeNodeProps> = ({
    node,
    depth,
    maxDepth,
    collapsedSet,
    toggleCollapse,
    onVote,
    onReply,
    onFlag,
    onContinueThread,
    voteEvent,
    replyEvent,
    flagEvent,
    continueThreadEvent,
    showActions,
}) => {
    const eventBus = useEventBus();
    const { t } = useTranslate();
    const nodeId = node.id as string;
    const authorName = node.authorName as string;
    const authorAvatarUrl = node.authorAvatarUrl as string | undefined;
    const content = node.content as string;
    const postedAt = node.postedAt as string;
    const voteCount = node.voteCount as number | undefined;
    const userVote = node.userVote as VoteValue | undefined;
    const replies = node.replies as readonly EntityRow[] | undefined;
    const hasReplies = !!replies && replies.length > 0;
    const isCollapsed = collapsedSet.has(nodeId);
    const atMaxDepth = depth >= maxDepth;
    // Inline reply composer: opens beneath this node so the reply box stays in
    // place instead of swapping the whole view.
    const [replyOpen, setReplyOpen] = useState(false);
    const [draft, setDraft] = useState("");

    const handleVote = useCallback(
        (next: VoteValue) => {
            onVote?.(nodeId, next);
            if (voteEvent) eventBus.emit(`UI:${voteEvent}`, { nodeId, vote: next });
        },
        [nodeId, onVote, voteEvent, eventBus],
    );

    // Toggle the inline composer open/closed (notify the host that a reply was
    // initiated, but don't emit the reply itself until the user submits text).
    const handleReply = useCallback(() => {
        onReply?.(nodeId);
        setReplyOpen((open) => !open);
    }, [nodeId, onReply]);

    const handleSubmitReply = useCallback(() => {
        const text = draft.trim();
        if (!text) return;
        if (replyEvent) eventBus.emit(`UI:${replyEvent}`, { parentNodeId: nodeId, content: text });
        setDraft("");
        setReplyOpen(false);
    }, [nodeId, draft, replyEvent, eventBus]);

    const handleCancelReply = useCallback(() => {
        setDraft("");
        setReplyOpen(false);
    }, []);

    const handleFlag = useCallback(() => {
        onFlag?.(nodeId);
        if (flagEvent) eventBus.emit(`UI:${flagEvent}`, { nodeId });
    }, [nodeId, onFlag, flagEvent, eventBus]);

    const handleContinue = useCallback(() => {
        onContinueThread?.(nodeId);
        if (continueThreadEvent) eventBus.emit(`UI:${continueThreadEvent}`, { nodeId });
    }, [nodeId, onContinueThread, continueThreadEvent, eventBus]);

    const handleToggle = useCallback(() => {
        toggleCollapse(nodeId);
    }, [nodeId, toggleCollapse]);

    return (
        <Box className="flex flex-row gap-2 items-stretch min-w-0">
            <Box className="flex flex-col items-center flex-shrink-0 w-6">
                {hasReplies ? (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleToggle}
                        aria-label={isCollapsed ? t('replyTree.expandReplies') : t('replyTree.collapseReplies')}
                        aria-expanded={!isCollapsed}
                        leftIcon={isCollapsed ? "chevron-right" : "chevron-down"}
                        className={cn(
                            "w-6 h-6 p-0 min-w-0",
                            "rounded-interactive text-muted-foreground",
                            "hover:bg-muted hover:text-foreground",
                        )}
                    />
                ) : (
                    <Box className="w-6 h-6" aria-hidden="true" />
                )}
                {hasReplies && !isCollapsed && (
                    <Box
                        className="flex-1 w-px bg-border mt-1"
                        aria-hidden="true"
                    />
                )}
            </Box>

            <Box className="flex flex-col gap-2 flex-1 min-w-0 pb-3">
                <Box className="flex flex-row gap-2 items-center min-w-0">
                    <Avatar
                        src={authorAvatarUrl}
                        name={authorName}
                        size="sm"
                    />
                    <Typography variant="body" weight="semibold">
                        {authorName}
                    </Typography>
                    <Typography variant="caption" color="secondary">
                        {postedAt}
                    </Typography>
                </Box>

                <Typography variant="body" className="whitespace-pre-wrap break-words">
                    {content}
                </Typography>

                {showActions && (
                    <Box className="flex flex-row gap-2 items-center">
                        <VoteStack
                            count={voteCount ?? 0}
                            userVote={userVote ?? null}
                            onVote={handleVote}
                            size="sm"
                            variant="horizontal"
                            label={t('replyTree.voteOnReplyBy', { author: authorName })}
                        />
                        <Button
                            variant="ghost"
                            size="sm"
                            leftIcon="message-square"
                            onClick={handleReply}
                            aria-label={t('replyTree.replyTo', { author: authorName })}
                        >
                            {t('replyTree.reply')}
                        </Button>
                        <Button
                            variant="ghost"
                            size="sm"
                            leftIcon="flag"
                            onClick={handleFlag}
                            aria-label={t('replyTree.flagReplyBy', { author: authorName })}
                        >
                            {t('replyTree.flag')}
                        </Button>
                    </Box>
                )}

                {replyOpen && (
                    <Box className="flex flex-col gap-2 mt-1">
                        <Input
                            inputType="textarea"
                            rows={2}
                            value={draft}
                            placeholder={t('replyTree.replyToPlaceholder', { author: authorName })}
                            onChange={(e) => setDraft(e.target.value)}
                            aria-label={t('replyTree.replyTo', { author: authorName })}
                        />
                        <Box className="flex flex-row gap-2 items-center">
                            <Button
                                variant="primary"
                                size="sm"
                                leftIcon="send"
                                onClick={handleSubmitReply}
                                disabled={!draft.trim()}
                            >
                                {t('replyTree.send')}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleCancelReply}>
                                {t('common.cancel')}
                            </Button>
                        </Box>
                    </Box>
                )}

                {hasReplies && !isCollapsed && (
                    atMaxDepth ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleContinue}
                            rightIcon="chevron-right"
                            className={cn(
                                "self-start gap-1 px-0 h-auto",
                                "text-sm text-primary hover:underline hover:bg-transparent",
                            )}
                        >
                            {t('replyTree.continueThread')}
                        </Button>
                    ) : (
                        <Box className="flex flex-col gap-2 mt-1">
                            {replies!.map((child) => (
                                <ReplyTreeNode
                                    key={child.id as string}
                                    node={child}
                                    depth={depth + 1}
                                    maxDepth={maxDepth}
                                    collapsedSet={collapsedSet}
                                    toggleCollapse={toggleCollapse}
                                    onVote={onVote}
                                    onReply={onReply}
                                    onFlag={onFlag}
                                    onContinueThread={onContinueThread}
                                    voteEvent={voteEvent}
                                    replyEvent={replyEvent}
                                    flagEvent={flagEvent}
                                    continueThreadEvent={continueThreadEvent}
                                    showActions={showActions}
                                />
                            ))}
                        </Box>
                    )
                )}
            </Box>
        </Box>
    );
};

function collectInitiallyCollapsed(nodes: readonly EntityRow[], acc: Set<string>): void {
    for (const n of nodes) {
        const replies = n.replies as readonly EntityRow[] | undefined;
        if (n.collapsed as boolean | undefined) acc.add(n.id as string);
        if (replies && replies.length > 0) {
            collectInitiallyCollapsed(replies, acc);
        }
    }
}

export const ReplyTree: React.FC<ReplyTreeProps> = ({
    nodes,
    maxDepth = 6,
    onVote,
    onReply,
    onFlag,
    onContinueThread,
    voteEvent,
    replyEvent,
    flagEvent,
    continueThreadEvent,
    showActions = true,
    className,
  ...rest
}) => {
    const { t } = useTranslate();
    const nodeList = Array.isArray(nodes) ? nodes : nodes ? [nodes] : [];
    const [collapsedSet, setCollapsedSet] = useState<Set<string>>(() => {
        const acc = new Set<string>();
        collectInitiallyCollapsed(nodeList, acc);
        return acc;
    });

    const toggleCollapse = useCallback((id: string) => {
        setCollapsedSet((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    if (nodeList.length === 0) {
        return (
            <Box {...domPassthrough(rest)} className={cn("text-sm text-muted-foreground", className)}>
                {t('replyTree.noRepliesYet')}
            </Box>
        );
    }

    return (
        <Box {...domPassthrough(rest)} className={cn("flex flex-col gap-2 min-w-0", className)}>
            {nodeList.map((node) => (
                <ReplyTreeNode
                    key={node.id as string}
                    node={node}
                    depth={0}
                    maxDepth={maxDepth}
                    collapsedSet={collapsedSet}
                    toggleCollapse={toggleCollapse}
                    onVote={onVote}
                    onReply={onReply}
                    onFlag={onFlag}
                    onContinueThread={onContinueThread}
                    voteEvent={voteEvent}
                    replyEvent={replyEvent}
                    flagEvent={flagEvent}
                    continueThreadEvent={continueThreadEvent}
                    showActions={showActions}
                />
            ))}
        </Box>
    );
};

ReplyTree.displayName = "ReplyTree";
