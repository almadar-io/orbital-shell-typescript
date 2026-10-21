'use client';
/**
 * MachinePanel — the runtime debugger's live view: the orbital's flow (its traits as the units they were composed
 * from, in dependency layers, with their event wires), then one trait's `.lolo` and its AVL state machine. It follows
 * the latest hop; clicking a unit pins its trait and replays that trait's hops, clicking it again follows the run.
 *
 * @packageDocumentation
 */

import * as React from 'react';
import type { DependencyGraph, OrbitalSchema, TraitDescription, TraitValue, TransitionTrace } from '@almadar/core';
import { programTraits, type ProgramTrait } from '../../../../lib/avl-schema-parser';
import { describedTransitionLines, tracePlayback } from '../../../../lib/avl-play';
import { flowUnitOf, type TraitFlowUnit } from '../../../../lib/avl-trait-flow';
import { Box } from '../../../../core';
import { HStack, VStack } from '../../../../core';
import { RangeSlider } from '../../../../core';
import { Typography } from '../../../../core';
import { IconButton } from '../../molecules/IconButton';
import { CodeBlock } from '../../molecules/markdown/CodeBlock';
import { LoadingState } from '../../molecules/LoadingState';
import { ErrorState } from '../../molecules/ErrorState';
import { StateMachineView } from '../StateMachineView';
import { FlowCanvas, type TraitView } from '../../../avl/organisms/FlowCanvas';
import { useTranslate } from '../../../../core';

/** Reads a trait as `orb` prints it (`behavior/describe`). */
export type DescribeTrait = (value: TraitValue) => Promise<TraitDescription>;

export interface MachinePanelProps {
  schema: OrbitalSchema;
  transitions: readonly TransitionTrace[];
  /** Without it the panel draws the machine alone. */
  describe?: DescribeTrait;
  /** The program's behavior, naming the traits it authors itself; an imported trait carries its own. */
  behavior?: string;
  /** How long a replay shows each hop. */
  replayStepMs?: number;
  /** The program's imports (`behavior/dependencies`), placing each composed unit in its layer. */
  dependencies?: DependencyGraph;
}

/** The trait value a running trait is described as: the imported behavior's own trait, or the program's. */
export function describedValue(entry: ProgramTrait, behavior: string | undefined): TraitValue | null {
  const source = entry.trait.sourceBehavior;
  if (source) return { behavior: source.behavior, trait: source.originalName };
  return behavior ? { behavior, trait: entry.trait.name } : null;
}

type Described = { status: 'loading' } | { status: 'ready'; description: TraitDescription } | { status: 'failed'; error: string };

// The demo's split: each column at rest at its share, the hovered or focused one grows.
const COLUMN = 'min-w-0 min-h-0 w-auto basis-0 grow transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none hover:grow-[3] focus-within:grow-[3]';
// The flow is a wide layered graph: it rests wider than the code and the machine.
const FLOW_COLUMN = 'min-w-0 min-h-0 w-auto basis-0 grow-[1.6] transition-[flex-grow] duration-500 ease-out motion-reduce:transition-none hover:grow-[4] focus-within:grow-[4]';

/** Where a pinned trait's replay stands: the hop it shows (into that trait's own hops) and whether it is advancing. */
interface Replay {
  step: number;
  playing: boolean;
}

const FLOW_ONLY: TraitView = { lens: 'flow', filter: null };

export function MachinePanel({ schema, transitions, describe, behavior, replayStepMs = 800, dependencies }: MachinePanelProps): React.ReactElement {
  const { t } = useTranslate();
  const entries = React.useMemo(() => programTraits(schema), [schema]);
  // The registry also holds `server:<Orbital>` dispatch verdicts; only the program's traits hop.
  const ran = React.useMemo(() => {
    const names = new Set(entries.map((e) => e.level.name));
    return transitions.filter((h) => names.has(h.traitName));
  }, [entries, transitions]);
  const [pinned, setPinned] = React.useState<string | null>(null);
  const [replay, setReplay] = React.useState<Replay | null>(null);
  const [described, setDescribed] = React.useState<ReadonlyMap<string, Described>>(new Map());

  const latest = ran[ran.length - 1]?.traitName;
  const name = pinned ?? latest ?? entries[0]?.level.name;
  const entry = entries.find((e) => e.level.name === name);
  const hops = React.useMemo(() => ran.filter((h) => h.traitName === name), [ran, name]);
  const value = entry ? describedValue(entry, behavior) : null;
  const key = value ? `${value.behavior}.traits.${value.trait}` : null;
  const source = key ? described.get(key) : undefined;

  React.useEffect(() => {
    if (!describe || !value || !key || described.has(key)) return;
    setDescribed((prev) => new Map(prev).set(key, { status: 'loading' }));
    describe(value).then(
      (description) => setDescribed((prev) => new Map(prev).set(key, { status: 'ready', description })),
      (error: Error) => setDescribed((prev) => new Map(prev).set(key, { status: 'failed', error: error.message })),
    );
  }, [describe, value, key, described]);

  React.useEffect(() => {
    if (!replay?.playing) return;
    const timer = setTimeout(() => {
      setReplay((r) => (r ? (r.step + 1 < hops.length ? { step: r.step + 1, playing: r.step + 2 < hops.length } : { ...r, playing: false }) : r));
    }, replayStepMs);
    return () => clearTimeout(timer);
  }, [replay, hops.length, replayStepMs]);

  // A unit's trait to show: the one of its traits that ran last, else its first.
  const pickUnit = (unit: TraitFlowUnit): void => {
    if (pinned !== null && entry && flowUnitOf(entry.trait) === unit.id) {
      setPinned(null);
      setReplay(null);
      return;
    }
    const members = [...unit.traits, ...unit.renderPieces];
    const trait = [...ran].reverse().find((h) => members.includes(h.traitName))?.traitName ?? members[0];
    if (trait === undefined) return;
    const count = ran.filter((h) => h.traitName === trait).length;
    setPinned(trait);
    setReplay(count > 0 ? { step: 0, playing: count > 1 } : null);
  };
  const stepTo = (step: number): void => setReplay({ step: Math.max(0, Math.min(hops.length - 1, step)), playing: false });
  const togglePlay = (): void => {
    if (!replay) return;
    if (replay.playing) setReplay({ ...replay, playing: false });
    else setReplay({ step: replay.step + 1 < hops.length ? replay.step : 0, playing: hops.length > 1 });
  };

  if (!entry) {
    return (
      <Box padding="md" data-testid="machine-panel-empty">
        <Typography variant="small" color="muted">{t('debug.noMachines')}</Typography>
      </Box>
    );
  }

  const shown = replay ? hops.slice(0, replay.step + 1) : hops;
  const playback = tracePlayback(entry.level, shown);
  const fired = playback.activeTransition !== undefined ? entry.level.transitions[playback.activeTransition] : undefined;
  const highlight = source?.status === 'ready' && fired ? describedTransitionLines(source.description, entry.level, fired) : undefined;

  const machine = (
    <StateMachineView
      trait={entry.level}
      activeState={playback.activeState}
      activeTransition={playback.activeTransition}
      visitedStates={playback.visitedStates}
      followActive
      showHeader={false}
      aria-label={`${entry.level.name} — ${t('debug.machine')}`}
    />
  );

  const code = !describe || !value ? null
    : source?.status === 'ready' && source.description.source ? (
      <CodeBlock
        code={source.description.source.text}
        language="lolo"
        title={`${value.trait}.lolo`}
        highlightLines={highlight}
        maxHeight="100%"
        showCopyButton
        className="h-full"
      />
    ) : source?.status === 'failed' ? (
      <ErrorState message={source.error} />
    ) : (
      <LoadingState message={t('debug.sourceLoading')} />
    );

  return (
    <VStack
      gap="sm"
      className="h-full min-h-0 p-2"
      data-testid="machine-panel"
      data-trait={entry.level.name}
      data-following={pinned === null ? 'true' : 'false'}
      data-replay-step={replay ? String(replay.step) : undefined}
      data-replaying={replay ? String(replay.playing) : undefined}
    >
      <HStack gap="xs" align="center" className="min-w-0">
        <Typography variant="small" weight="medium" className="truncate font-mono">{entry.level.name}</Typography>
        {replay && (
          <HStack gap="xs" align="center" role="toolbar" aria-label={t('debug.replay')} className="ms-auto min-w-0 flex-1 max-w-md">
            <IconButton icon="chevron-left" label={t('debug.replayBack')} className="w-7 h-7" onClick={() => stepTo(replay.step - 1)} disabled={replay.step === 0} data-testid="machine-panel-replay-back" />
            <IconButton icon={replay.playing ? 'pause' : 'play'} label={replay.playing ? t('debug.replayPause') : t('debug.replayPlay')} className="w-7 h-7" onClick={togglePlay} data-testid="machine-panel-replay-toggle" />
            <IconButton icon="chevron-right" label={t('debug.replayForward')} className="w-7 h-7" onClick={() => stepTo(replay.step + 1)} disabled={replay.step + 1 >= hops.length} data-testid="machine-panel-replay-forward" />
            <RangeSlider size="sm" min={0} max={Math.max(0, hops.length - 1)} step={1} value={replay.step} onChange={stepTo} aria-label={t('debug.replay')} className="min-w-16 flex-1" />
            <Typography variant="caption" color="muted" className="shrink-0 tabular-nums">{t('debug.replayStep', { step: replay.step + 1, total: hops.length })}</Typography>
          </HStack>
        )}
      </HStack>
      <HStack gap="sm" align="stretch" className="flex-1 min-h-0">
        <Box className={FLOW_COLUMN}>
          <FlowCanvas
            schema={schema}
            initialLevel="trait-expanded"
            initialOrbital={entry.orbital}
            traitView={FLOW_ONLY}
            toolbar={false}
            fitOnResize
            systemDependencies={dependencies}
            flowSelection={pinned !== null || latest !== undefined ? flowUnitOf(entry.trait) : null}
            onFlowSelect={pickUnit}
            width="100%"
            height="100%"
          />
        </Box>
        {code && <Box className={COLUMN}>{code}</Box>}
        <Box className={COLUMN}>{machine}</Box>
      </HStack>
    </VStack>
  );
}

MachinePanel.displayName = 'MachinePanel';
