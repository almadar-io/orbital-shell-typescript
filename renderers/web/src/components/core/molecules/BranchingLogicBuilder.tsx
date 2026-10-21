'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type { EventEmit, EventPayload, EventPayloadValue, A11yProps } from '@almadar/core';
import { Plus, Trash, ArrowRight, GitBranch, Eye, Pencil } from 'lucide-react';
import { Select } from '../../../core';
import type { SelectOption } from '../../../core';
import { Typography } from '../../../core';
import { Button } from '../../../core';
import { Input } from '../../../core';
import { Badge } from '../../../core';
import { Card } from '../../../core';
import { FilterPill } from '../../../core';
import { Box } from '../../../core';
import { useEventBus } from '../../../core';
import { useTranslate } from '../../../core';
import { cn } from '../../../core';
import { useContentSurface } from '../../../core';
import type { SurfaceMode } from '@almadar/core';

import { domPassthrough } from '../../../core';
export interface BranchingQuestion {
  id: string;
  label: string;
  optionValues?: string[];
}

export type BranchingOperator = 'equals' | 'not-equals' | 'contains' | 'in';

export const END_OF_SURVEY = 'end-of-survey';

export interface BranchingRule extends EventPayload {
  id: string;
  sourceQuestionId: string;
  operator: BranchingOperator;
  value: string | string[];
  targetQuestionId: string | typeof END_OF_SURVEY;
}

export interface BranchingLogicBuilderProps extends A11yProps {
  questions: readonly BranchingQuestion[] | EventPayloadValue;
  /**
   * Rules. Accepts either a typed array (direct consumers) or the runtime
   * payload shape from a render-ui binding (`@payload.data`). Narrowed to
   * `[]` internally when the value isn't an array.
   */
  rules: readonly BranchingRule[] | EventPayloadValue;
  /** Content surface: `auto` paints the theme's surface behind this block unless it already sits on one (a card, dialog or another block); `none` opts out. */
  surface?: SurfaceMode;
  onRulesChange?: (rules: BranchingRule[]) => void;
  /** Event name dispatched via event bus when rules change. Payload: `{ rules }`. */
  rulesChangeEvent?: EventEmit<{ rules: BranchingRule[] }>;
  readOnly?: boolean;
  className?: string;
}

type ViewMode = 'edit' | 'graph';

function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function questionsToOptions(
  questions: readonly BranchingQuestion[],
  endOfSurveyLabel: string | null,
): SelectOption[] {
  const opts: SelectOption[] = questions.map((q) => ({
    value: q.id,
    label: q.label,
  }));
  if (endOfSurveyLabel !== null) {
    opts.push({ value: END_OF_SURVEY, label: endOfSurveyLabel });
  }
  return opts;
}

function isRuleBroken(rule: BranchingRule, questions: readonly BranchingQuestion[]): boolean {
  const sourceExists = questions.some((q) => q.id === rule.sourceQuestionId);
  const targetExists =
    rule.targetQuestionId === END_OF_SURVEY ||
    questions.some((q) => q.id === rule.targetQuestionId);
  return !sourceExists || !targetExists;
}

interface RuleRowProps {
  rule: BranchingRule;
  questions: readonly BranchingQuestion[];
  readOnly: boolean;
  broken: boolean;
  onChange: (next: BranchingRule) => void;
  onDelete: () => void;
}

const RuleRow: React.FC<RuleRowProps> = ({
  rule,
  questions,
  readOnly,
  broken,
  onChange,
  onDelete,
}) => {
  const { t } = useTranslate();
  const operatorOptions: SelectOption[] = useMemo(
    () => [
      { value: 'equals', label: t('branchingLogic.operatorEquals') },
      { value: 'not-equals', label: t('branchingLogic.operatorNotEquals') },
      { value: 'contains', label: t('branchingLogic.operatorContains') },
      { value: 'in', label: t('branchingLogic.operatorIn') },
    ],
    [t],
  );
  const sourceOptions = useMemo(() => questionsToOptions(questions, null), [questions]);
  const targetOptions = useMemo(
    () => questionsToOptions(questions, t('branchingLogic.endOfSurvey')),
    [questions, t],
  );

  const sourceQuestion = questions.find((q) => q.id === rule.sourceQuestionId);
  const valueOptions: SelectOption[] = useMemo(() => {
    if (!sourceQuestion?.optionValues) return [];
    return sourceQuestion.optionValues.map((v) => ({ value: v, label: v }));
  }, [sourceQuestion]);

  const handleSource = (v: string | string[]) => {
    onChange({ ...rule, sourceQuestionId: v as string });
  };

  const handleOperator = (v: string | string[]) => {
    const next = v as BranchingOperator;
    const nextValue: string | string[] =
      next === 'in' && !Array.isArray(rule.value)
        ? rule.value
          ? [rule.value]
          : []
        : next !== 'in' && Array.isArray(rule.value)
          ? rule.value[0] ?? ''
          : rule.value;
    onChange({ ...rule, operator: next, value: nextValue });
  };

  const handleScalarValue = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ ...rule, value: e.target.value });
  };

  const handleAddChip = (v: string | string[]) => {
    const val = v as string;
    if (!val) return;
    const current = Array.isArray(rule.value) ? rule.value : [];
    if (current.includes(val)) return;
    onChange({ ...rule, value: [...current, val] });
  };

  const handleRemoveChip = (chip: string) => {
    const current = Array.isArray(rule.value) ? rule.value : [];
    onChange({ ...rule, value: current.filter((c) => c !== chip) });
  };

  const handleTarget = (v: string | string[]) => {
    onChange({ ...rule, targetQuestionId: v as BranchingRule['targetQuestionId'] });
  };

  const isMulti = rule.operator === 'in';
  const chips = Array.isArray(rule.value) ? rule.value : [];
  const scalarValue = Array.isArray(rule.value) ? '' : rule.value;

  return (
    <Card
      variant="bordered"
      padding="sm"
      className={cn(
        'flex flex-col gap-2',
        broken && 'border-error',
      )}
    >
      <Box className="flex flex-wrap items-center gap-2">
        <Typography variant="label" weight="semibold" className="shrink-0">
          {t('branchingLogic.if')}
        </Typography>

        <Box className="min-w-[10rem] grow basis-40">
          <Select
            options={sourceOptions}
            value={rule.sourceQuestionId}
            placeholder={t('branchingLogic.selectQuestion')}
            onValueChange={handleSource}
            disabled={readOnly}
            error={broken ? t('branchingLogic.brokenReference') : undefined}
          />
        </Box>

        <Box className="min-w-[8rem] basis-32">
          <Select
            options={operatorOptions}
            value={rule.operator}
            onValueChange={handleOperator}
            disabled={readOnly}
          />
        </Box>

        {isMulti ? (
          <Box className="flex min-w-[10rem] grow basis-40 flex-wrap items-center gap-1">
            {chips.map((chip) => (
              <FilterPill
                key={chip}
                variant="primary"
                size="sm"
                label={chip}
                removable={!readOnly}
                onRemove={readOnly ? undefined : () => handleRemoveChip(chip)}
              />
            ))}
            {valueOptions.length > 0 ? (
              <Box className="min-w-[8rem]">
                <Select
                  options={valueOptions.filter((o) => !chips.includes(o.value))}
                  value=""
                  placeholder={t('branchingLogic.addValue')}
                  onValueChange={handleAddChip}
                  disabled={readOnly}
                />
              </Box>
            ) : (
              <Input
                inputType="text"
                placeholder={t('branchingLogic.typeValuePressEnter')}
                value=""
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const target = e.target as HTMLInputElement;
                  const v = target.value.trim();
                  if (!v || chips.includes(v)) return;
                  onChange({ ...rule, value: [...chips, v] });
                  target.value = '';
                }}
                disabled={readOnly}
              />
            )}
          </Box>
        ) : (
          <Box className="min-w-[8rem] grow basis-32">
            {valueOptions.length > 0 ? (
              <Select
                options={valueOptions}
                value={scalarValue}
                placeholder={t('branchingLogic.selectValue')}
                onValueChange={(v) => onChange({ ...rule, value: v as string })}
                disabled={readOnly}
              />
            ) : (
              <Input
                inputType="text"
                placeholder={t('branchingLogic.value')}
                value={scalarValue}
                onChange={handleScalarValue}
                disabled={readOnly}
              />
            )}
          </Box>
        )}

        <Typography variant="label" weight="semibold" className="shrink-0 inline-flex items-center gap-1">
          <ArrowRight className="h-4 w-4" />
          {t('branchingLogic.goTo')}
        </Typography>

        <Box className="min-w-[10rem] grow basis-40">
          <Select
            options={targetOptions}
            value={rule.targetQuestionId}
            placeholder={t('branchingLogic.selectTarget')}
            onValueChange={handleTarget}
            disabled={readOnly}
            error={
              broken && rule.targetQuestionId !== END_OF_SURVEY
                ? t('branchingLogic.brokenReference')
                : undefined
            }
          />
        </Box>

        {!readOnly && (
          <Button
            variant="ghost"
            size="sm"
            leftIcon={Trash}
            action="DELETE_RULE"
            actionPayload={{ ruleId: rule.id }}
            onClick={onDelete}
            aria-label={t('branchingLogic.deleteRule')}
          />
        )}
      </Box>

      {broken && (
        <Badge variant="error" size="sm" label={t('branchingLogic.brokenReference')} />
      )}
    </Card>
  );
};

interface LogicGraphProps {
  questions: readonly BranchingQuestion[];
  rules: BranchingRule[];
  surface: SurfaceMode;
}

const NODE_WIDTH = 180;
const NODE_HEIGHT = 56;
const NODE_GAP_Y = 80;
const PADDING = 32;

const LogicGraph: React.FC<LogicGraphProps> = ({ questions, rules, surface }) => {
  const contentSurface = useContentSurface(surface);
  const { t } = useTranslate();
  const endOfSurveyLabel = t('branchingLogic.endOfSurvey');
  const layout = useMemo(() => {
    const items = [
      ...questions.map((q) => ({ id: q.id, label: q.label, isEnd: false })),
      { id: END_OF_SURVEY, label: endOfSurveyLabel, isEnd: true },
    ];
    const positions: Record<string, { x: number; y: number }> = {};
    items.forEach((item, i) => {
      positions[item.id] = {
        x: PADDING,
        y: PADDING + i * (NODE_HEIGHT + NODE_GAP_Y),
      };
    });
    const width = NODE_WIDTH + PADDING * 2 + 220;
    const height = PADDING * 2 + items.length * (NODE_HEIGHT + NODE_GAP_Y);
    return { items, positions, width, height };
  }, [questions, endOfSurveyLabel]);

  return contentSurface.provide(
    <Box className={cn('overflow-auto p-2', contentSurface.className)}>
      <svg
        width={layout.width}
        height={layout.height}
        role="img"
        aria-label={t('branchingLogic.graphAriaLabel')}
        style={{ display: 'block' }}
      >
        <defs>
          <marker
            id="branching-arrowhead"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--color-muted-foreground)" />
          </marker>
        </defs>

        {rules.map((rule, i) => {
          const from = layout.positions[rule.sourceQuestionId];
          const to = layout.positions[rule.targetQuestionId];
          if (!from || !to) return null;
          const startX = from.x + NODE_WIDTH;
          const startY = from.y + NODE_HEIGHT / 2;
          const endX = to.x + NODE_WIDTH;
          const endY = to.y + NODE_HEIGHT / 2;
          const offset = 40 + (i % 4) * 30;
          const cx = Math.max(startX, endX) + offset;
          const path = `M ${startX} ${startY} C ${cx} ${startY}, ${cx} ${endY}, ${endX} ${endY}`;
          const labelText =
            rule.operator === 'in' && Array.isArray(rule.value)
              ? `in [${rule.value.join(', ')}]`
              : `${rule.operator} ${Array.isArray(rule.value) ? rule.value.join(', ') : rule.value}`;
          const labelY = (startY + endY) / 2;
          return (
            <g key={rule.id}>
              <path
                d={path}
                fill="none"
                stroke="var(--color-muted-foreground)"
                strokeWidth={1.5}
                markerEnd="url(#branching-arrowhead)"
              />
              <rect
                x={cx - 4}
                y={labelY - 10}
                width={Math.min(160, labelText.length * 7 + 12)}
                height={20}
                rx={4}
                fill="var(--color-card)"
                stroke="var(--color-border)"
              />
              <text
                x={cx + 4}
                y={labelY + 4}
                fontSize="11"
                fontFamily="JetBrains Mono, monospace"
                fill="var(--color-foreground)"
              >
                {labelText.length > 22 ? `${labelText.slice(0, 21)}…` : labelText}
              </text>
            </g>
          );
        })}

        {layout.items.map((item) => {
          const pos = layout.positions[item.id];
          return (
            <g key={item.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                fill={item.isEnd ? 'var(--color-surface)' : 'var(--color-card)'}
                stroke={item.isEnd ? 'var(--color-error)' : 'var(--color-border)'}
                strokeWidth={item.isEnd ? 2 : 1.5}
              />
              <text
                x={pos.x + NODE_WIDTH / 2}
                y={pos.y + NODE_HEIGHT / 2 + 4}
                textAnchor="middle"
                fontSize="13"
                fontFamily="Inter, sans-serif"
                fill="var(--color-foreground)"
                fontWeight={600}
              >
                {item.label.length > 22 ? `${item.label.slice(0, 21)}…` : item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </Box>,
  );
};

export const BranchingLogicBuilder: React.FC<BranchingLogicBuilderProps> = ({
  questions: questionsProp,
  rules: rulesProp,
  onRulesChange,
  rulesChangeEvent,
  readOnly = false,
  className,
  surface = 'auto',
  ...rest
}) => {
  const { t } = useTranslate();
  const eventBus = useEventBus();
  const questions: readonly BranchingQuestion[] = Array.isArray(questionsProp)
    ? (questionsProp as readonly BranchingQuestion[])
    : [];
  const rulesInitial: readonly BranchingRule[] = Array.isArray(rulesProp)
    ? (rulesProp as readonly BranchingRule[])
    : [];
  const [rules, setRules] = useState<BranchingRule[]>([...rulesInitial]);
  const [view, setView] = useState<ViewMode>('edit');

  useEffect(() => {
    setRules(Array.isArray(rulesProp) ? [...(rulesProp as readonly BranchingRule[])] : []);
  }, [rulesProp]);

  const updateRules = useCallback(
    (next: BranchingRule[]) => {
      setRules(next);
      onRulesChange?.(next);
      if (rulesChangeEvent) {
        eventBus.emit(`UI:${rulesChangeEvent}`, { rules: next });
      }
    },
    [onRulesChange, rulesChangeEvent, eventBus],
  );

  const handleAddRule = useCallback(() => {
    const firstQ = questions[0];
    if (!firstQ) return;
    const target = questions[1]?.id ?? END_OF_SURVEY;
    const next: BranchingRule = {
      id: generateRuleId(),
      sourceQuestionId: firstQ.id,
      operator: 'equals',
      value: firstQ.optionValues?.[0] ?? '',
      targetQuestionId: target,
    };
    updateRules([...rules, next]);
  }, [questions, rules, updateRules]);

  const handleRuleChange = useCallback(
    (id: string, next: BranchingRule) => {
      updateRules(rules.map((r) => (r.id === id ? next : r)));
    },
    [rules, updateRules],
  );

  const handleRuleDelete = useCallback(
    (id: string) => {
      updateRules(rules.filter((r) => r.id !== id));
    },
    [rules, updateRules],
  );

  const brokenCount = useMemo(
    () => rules.filter((r) => isRuleBroken(r, questions)).length,
    [rules, questions],
  );

  const noQuestions = questions.length === 0;

  return (
    <Box {...domPassthrough(rest)} className={cn('flex flex-col gap-3', className)}>
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Box className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-foreground" />
          <Typography variant="subheading" weight="semibold">
            {t('branchingLogic.title')}
          </Typography>
          <Badge
            variant="neutral"
            size="sm"
            label={
              rules.length === 1
                ? t('branchingLogic.ruleCountOne', { count: rules.length })
                : t('branchingLogic.ruleCountOther', { count: rules.length })
            }
          />
          {brokenCount > 0 && (
            <Badge
              variant="error"
              size="sm"
              label={t('branchingLogic.brokenCount', { count: brokenCount })}
            />
          )}
        </Box>

        <Box className="flex items-center gap-1 rounded-container border border-border bg-card p-0.5">
          <Button
            variant={view === 'edit' ? 'primary' : 'ghost'}
            size="sm"
            leftIcon={Pencil}
            action="VIEW_EDIT"
            onClick={() => setView('edit')}
          >
            {t('branchingLogic.rules')}
          </Button>
          <Button
            variant={view === 'graph' ? 'primary' : 'ghost'}
            size="sm"
            leftIcon={Eye}
            action="VIEW_GRAPH"
            onClick={() => setView('graph')}
          >
            {t('branchingLogic.logicGraph')}
          </Button>
        </Box>
      </Box>

      {view === 'edit' ? (
        <Box className="flex flex-col gap-2">
          {rules.length === 0 ? (
            <Card variant="bordered" padding="lg" className="text-center">
              <Typography variant="body" color="muted">
                {noQuestions
                  ? t('branchingLogic.emptyNoQuestions')
                  : t('branchingLogic.emptyNoRules')}
              </Typography>
            </Card>
          ) : (
            rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                questions={questions}
                readOnly={readOnly}
                broken={isRuleBroken(rule, questions)}
                onChange={(next) => handleRuleChange(rule.id, next)}
                onDelete={() => handleRuleDelete(rule.id)}
              />
            ))
          )}

          {!readOnly && (
            <Box>
              <Button
                variant="secondary"
                size="sm"
                leftIcon={Plus}
                action="ADD_RULE"
                onClick={handleAddRule}
                disabled={noQuestions}
              >
                {t('branchingLogic.addRule')}
              </Button>
            </Box>
          )}
        </Box>
      ) : (
        <LogicGraph questions={questions} rules={rules} surface={surface} />
      )}
    </Box>
  );
};

BranchingLogicBuilder.displayName = 'BranchingLogicBuilder';
