'use client';

/**
 * AvlTransitionDetail — cosmic L4: one transition as circuits. The guard is
 * a board of its own; each effect is a board in an accordion. Given a
 * played step the boards show that run's values; `stepEvent` adds a
 * payload editor and a Step button that asks the host to play this
 * transition.
 */

import React, { useMemo, useState } from 'react';
import type { EventEmit, OrbitalSchema, SExpr, TraitConfigObject, TraitConfigValue } from '@almadar/core';
import { Card } from '../../../core';
import { Box } from '../../../core';
import { HStack, VStack } from '../../../core';
import { Typography } from '../../../core';
import { Badge } from '../../../core';
import { Button } from '../../../core';
import { Accordion, type AccordionItem } from '../../core/molecules/Accordion';
import { JsonTreeEditor } from '../../core/molecules/JsonTreeEditor';
import { AvlCircuit } from './AvlCircuit';
import { useTranslate } from '../../../core';
import { effectZoneOf } from '../../../lib/avl-theme';
import { parseTraitLevel, type TraitTransitionInfo } from '../../../lib/avl-schema-parser';
import { transitionPlayback, type AvlPlayStep, type AvlStepRequest, type AvlTransitionPlayback } from '../../../lib/avl-play';
import { EmptyState } from '../../core/molecules/EmptyState';
import type { AvlAnnotations, AvlNote } from '../../../lib/avl-annotations';
import { AvlEffectChip } from './AvlEffectChip';
import { AvlExplain } from './AvlExplain';

/**
 * One transition explained: from-state, event and to-state, the guard that
 * must hold, and each effect it runs in order, drawn as circuit boards.
 *
 * @capabilities transition explainer, event guard effects walkthrough, state machine step detail
 */
export interface AvlTransitionDetailProps {
  /** Orbital the transition belongs to. */
  orbital: string;
  /** Trait the transition belongs to. */
  trait: string;
  /** The transition to explain.
   * @example {"from":"pending","to":"paid","event":"PAY","effects":[{"type":"set","args":[]},{"type":"persist","args":[]}],"index":0}
   */
  transition?: TraitTransitionInfo;
  /** The program the transition belongs to (object or JSON text), when it is given by position instead of `transition`. */
  schema?: OrbitalSchema | string;
  /** The transition's position among the trait's transitions, read from `schema`. */
  transitionIndex?: number;
  /** Played steps; the one at `cursor` that ran this transition lights the boards (with `schema`). */
  scene?: readonly AvlPlayStep[];
  /** The scene step shown. Default: the last. */
  cursor?: number;
  /** Author explanations shown in a popover on hover: the transition's event note and per-effect-type notes.
   * @example {"transitions":{"PAY":{"title":"Paying","body":"The customer pays the order total."}},"effects":{"persist":{"body":"Saves the order."}}}
   */
  annotations?: AvlAnnotations;
  /** The latest played run of this transition (see `transitionPlayback`). */
  playback?: AvlTransitionPlayback;
  /** Emits UI:{stepEvent} with an {@link AvlStepRequest} when Step is pressed. */
  stepEvent?: EventEmit<AvlStepRequest>;
  className?: string;
}

const isConfigObject = (v: TraitConfigValue): v is TraitConfigObject =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const EffectHeader: React.FC<{ type: string; failed: boolean; failedLabel: string; note?: AvlNote }> = ({ type, failed, failedLabel, note }) => (
  <HStack gap="sm" align="center">
    <AvlEffectChip effectType={type} size={18} note={note} />
    <Badge variant="primary" size="sm">{type}</Badge>
    {failed ? <Badge variant="danger" size="sm">{failedLabel}</Badge> : null}
  </HStack>
);

type ResolvedDetailProps = Omit<AvlTransitionDetailProps, 'transition' | 'schema' | 'transitionIndex' | 'scene' | 'cursor'> & { transition: TraitTransitionInfo };

export const AvlTransitionDetail: React.FC<AvlTransitionDetailProps> = ({ schema, transitionIndex, scene, cursor, transition, playback, ...rest }) => {
  const { t } = useTranslate();
  const resolved = useMemo(() => {
    if (transition) return { transition, playback };
    if (schema === undefined || transitionIndex === undefined) return null;
    const program: OrbitalSchema = typeof schema === 'string' ? JSON.parse(schema) : schema;
    const level = parseTraitLevel(program, rest.orbital, rest.trait);
    const found = level?.transitions[transitionIndex];
    if (!level || !found) return null;
    const steps = scene ?? [];
    return { transition: found, playback: playback ?? transitionPlayback(level, rest.orbital, found, steps, cursor ?? steps.length - 1) };
  }, [transition, playback, schema, transitionIndex, scene, cursor, rest.orbital, rest.trait]);
  if (!resolved) return <Box data-testid="avl-transition-missing"><EmptyState icon="git-branch" title={t('avl.transitionMissing')} /></Box>;
  return <TransitionDetailBody {...rest} transition={resolved.transition} {...(resolved.playback ? { playback: resolved.playback } : {})} />;
};

const TransitionDetailBody: React.FC<ResolvedDetailProps> = ({ orbital, trait, transition, annotations, playback, stepEvent, className }) => {
  const { t } = useTranslate();
  const [payload, setPayload] = useState<TraitConfigObject>({});

  const guard = transition.guard ?? null;
  const guardRun = playback?.guard;
  const request: AvlStepRequest = { orbital, trait, from: transition.from, event: transition.event, payload };

  const effectItems = useMemo<AccordionItem[]>(
    () =>
      transition.effects.map((effect, i) => {
        const expr: SExpr = [effect.type, ...effect.args];
        const ran = playback?.effects[i];
        return {
          id: `effect-${i}`,
          header: (
            <EffectHeader type={effect.type} failed={ran?.status === 'failed'} failedLabel={t('avl.play.effectFailed')} note={annotations?.effects?.[effect.type]} />
          ),
          content: <AvlCircuit expr={expr} trace={ran?.evalTrace} showCode />,
        };
      }),
    [transition.effects, playback, t, annotations],
  );
  const openEffects = transition.effects
    .map((effect, i) => (effectZoneOf(effect.type) === 'screen' ? null : `effect-${i}`))
    .filter((id): id is string => id !== null);

  return (
    <Card className={`w-full max-w-5xl mx-auto ${className ?? ''}`} shadow="md" data-testid="avl-transition-detail">
      <Box className="p-6">
        <VStack gap="lg">
          <HStack gap="md" justify="between" align="center" wrap>
            <HStack gap="sm" align="center">
              <Badge variant="neutral" size="lg">{transition.from}</Badge>
              {annotations?.transitions?.[transition.event] ? (
                <AvlExplain lines={[transition.event]} note={annotations.transitions[transition.event]}>
                  <Box as="span" tabIndex={0} data-testid="avl-td-event" className="underline decoration-dotted underline-offset-4 cursor-help">
                    <Typography variant="body1" weight="semibold" as="span">{transition.event}</Typography>
                  </Box>
                </AvlExplain>
              ) : (
                <Box as="span" data-testid="avl-td-event">
                  <Typography variant="body1" weight="semibold" as="span">{transition.event}</Typography>
                </Box>
              )}
              <Typography variant="h5" color="muted">→</Typography>
              <Badge variant="neutral" size="lg">{transition.to}</Badge>
            </HStack>
            {playback ? (
              <HStack gap="xs" align="center">
                <Badge variant={playback.fired ? 'success' : 'warning'} size="md" data-testid="avl-transition-verdict">
                  {playback.fired ? t('avl.play.fired') : guardRun && !guardRun.passed ? t('avl.play.blocked') : t('avl.play.notReached')}
                </Badge>
              </HStack>
            ) : null}
          </HStack>

          {stepEvent ? (
            <VStack gap="xs">
              <Typography variant="overline" color="muted">{t('avl.play.payload')}</Typography>
              <HStack gap="sm" align="start">
                <Box className="flex-1 min-w-0">
                  <JsonTreeEditor value={payload} onChange={(next) => setPayload(isConfigObject(next) ? next : {})} />
                </Box>
                <Button variant="primary" size="sm" action={stepEvent} actionPayload={request} leftIcon="skip-forward">
                  {t('avl.play.step')}
                </Button>
              </HStack>
            </VStack>
          ) : null}

          {!playback && stepEvent ? (
            <Typography variant="small" color="muted">{t('avl.play.notPlayed')}</Typography>
          ) : null}

          {guard !== null ? (
            <VStack gap="xs">
              <HStack gap="sm" align="center">
                <Typography variant="overline" color="muted">{t('avl.guard')}</Typography>
                <Typography variant="caption" color="muted" data-testid="avl-td-guard-caption">{t('avl.guardCaption')}</Typography>
                {guardRun ? (
                  <Badge variant={guardRun.passed ? 'success' : 'danger'} size="sm">
                    {guardRun.passed ? t('avl.play.guardPassed') : t('avl.play.guardFailed')}
                  </Badge>
                ) : null}
              </HStack>
              <AvlCircuit expr={guard} trace={guardRun?.trace} />
            </VStack>
          ) : null}

          {effectItems.length > 0 ? (
            <VStack gap="xs">
              <HStack gap="sm" align="center" wrap>
                <Typography variant="overline" color="muted">{t('avl.effects')} ({effectItems.length})</Typography>
                <Typography variant="caption" color="muted" data-testid="avl-td-effects-caption">{t('avl.effectsCaption')}</Typography>
              </HStack>
              <Accordion items={effectItems} multiple defaultOpenItems={openEffects} />
            </VStack>
          ) : null}
        </VStack>
      </Box>
    </Card>
  );
};

AvlTransitionDetail.displayName = 'AvlTransitionDetail';
