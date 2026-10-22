/**
 * The three kernel abilities an LLM tool loop is written with: `program/inputs` (reflection over the
 * running program's declared external inputs), `program/dispatch` (fire one of them AS THE CALLER, through
 * the host's ordinary input channel) and `persist/read-named` (read an entity chosen at run time, through its
 * `@read` policy for the caller). Each runs over the host ports a host lends one call (`ServiceHostPorts`),
 * so a dispatch meets the same guards, grants and policies as any other and a read returns only the rows the
 * caller may read. One function serves the interpreter, the kernel host and the generated server.
 * Mirrors `orbital-core` `agent_ports` (base) and `kernel/agent_ports` (runtime).
 *
 * @packageDocumentation
 */

import type { EntityRow } from '../types/entity.js';
import type { EventPayload, EventPayloadValue } from '../types/expression.js';
import { EventPayloadSchema } from '../types/expression.js';
import type { JsonValue } from '../types/json.js';
import type { JsonSchema } from '../factory/types.js';
import type { EventStreamItem, OrbitalEventResponse, ServiceHostPorts } from '../types/bus.js';
import { OrbitalEventRequestSchema } from '../types/bus.js';
import type { PayloadField } from '../types/state-machine.js';
import { PayloadFieldSchema } from '../types/state-machine.js';
import { orderRows } from '../row-query.js';
import { findInputByAddress, payloadIssues, payloadSchemaToJsonSchema, type ExternalInput, type PayloadIssue } from './externalInputs.js';

export const AGENT_PORT_OPERATORS = ['program/inputs', 'program/dispatch', 'persist/read-named'] as const;
export type AgentPortOperator = (typeof AGENT_PORT_OPERATORS)[number];

/** Narrow an effect head to one of the three agent-port operators. */
export function isAgentPortOperator(name: string): name is AgentPortOperator {
  return (AGENT_PORT_OPERATORS as readonly string[]).includes(name);
}

/** A typed failure issue: `code` names the kind, `message` says it. */
export type AgentPortIssue = {
  readonly code: string;
  readonly message: string;
  /** The HTTP status an event request's failure answers (`ORBITAL_NOT_FOUND` 404, ...). */
  readonly status?: number;
};

/** One declared input as the model is offered it. */
export interface ReflectedInput {
  orbital: string;
  trait: string;
  event: string;
  address: string;
  description?: string;
  synonyms?: string;
  tier?: string;
  payloadSchema: PayloadField[];
  parameters: JsonSchema;
}

/** `program/inputs`' result. */
export interface AgentReflection {
  inputs: ReflectedInput[];
  entities: string[];
  selected: ReflectedInput[];
  /** The host's last traced dispatch steps, when the options asked for `trace`. */
  trace?: JsonValue[];
}

export type DispatchIssue = PayloadIssue & { received?: string };

/** `program/dispatch`' result: what the model is told. */
export type DispatchAnswer =
  | { ok: true; emitted: Array<{ event: string; payload?: EventPayload }> }
  | { ok: false; error: string; issues?: DispatchIssue[] };

/** `persist/read-named`' result. */
export interface NamedRows {
  entity: string;
  count: number;
  rows: EntityRow[];
}

/** An inbound delivery's answer: the handler's status and the JSON text of its body. */
export interface InboundDeliveryAnswer {
  status: number;
  body: string;
}

export type AgentPortResult = AgentReflection | DispatchAnswer | NamedRows | OrbitalEventResponse | InboundDeliveryAnswer | JsonValue[] | (OrbitalEventResponse & { items: EventStreamItem[] });

export type AgentPortOutcome =
  | { readonly ok: true; readonly result: AgentPortResult }
  | { readonly ok: false; readonly error: string; readonly errors?: readonly AgentPortIssue[] };

export const UNKNOWN_ENTITY_CODE = 'unknown-entity';

const REFUSED_ARGUMENTS = 'arguments must be a JSON object';
const MISMATCHED_ARGUMENTS = 'the arguments do not match the tool';

function fail(error: string, errors?: readonly AgentPortIssue[]): AgentPortOutcome {
  return errors === undefined ? { ok: false, error } : { ok: false, error, errors };
}

function refusal(error: string, issues?: DispatchIssue[]): AgentPortOutcome {
  return { ok: true, result: issues === undefined ? { ok: false, error } : { ok: false, error, issues } };
}

/**
 * The success payload an agent-port effect emits: `result`, and `text` — `result` as JSON text, so a program
 * can hand a result whose shape it cannot declare (rows of an entity named at run time, the payloads a
 * dispatch emitted) on as text. One function, so every path writes the same text.
 */
export function agentPortPayload(result: AgentPortResult): { result: EventPayloadValue; text: string } {
  const text = JSON.stringify(result);
  const wire: EventPayloadValue = JSON.parse(text);
  return { result: wire, text };
}

/** One declared input as the model is offered it: the input, its qualified address and its JSON Schema. */
export function reflectInput(input: ExternalInput, payload: readonly PayloadField[] = input.payloadSchema): ReflectedInput {
  return {
    orbital: input.orbital,
    trait: input.trait,
    event: input.event,
    address: `${input.orbital}.${input.trait}.${input.event}`,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.synonyms !== undefined ? { synonyms: input.synonyms } : {}),
    ...(input.tier !== undefined ? { tier: input.tier } : {}),
    payloadSchema: [...payload],
    parameters: payloadSchemaToJsonSchema(payload),
  };
}

/** Why a dispatch did not take effect, or undefined when it did. */
export function dispatchFailureOf(response: OrbitalEventResponse): string | undefined {
  if (response.rejections && response.rejections.length > 0) return response.rejections.map((r) => r.code).join(', ');
  if (response.guardFailed !== undefined) return `guard failed: ${response.guardFailed}`;
  if (!response.success) return response.error ?? 'dispatch failed';
  const failed = (response.effectResults ?? []).find((r) => !r.success);
  if (failed) return failed.error ?? `${failed.effect} failed`;
  if (!response.transitioned) return 'no transition';
  return undefined;
}

/** What a dispatch answers the model: the events it emitted, or why it did not take effect. */
export function dispatchOutcomeOf(response: OrbitalEventResponse): DispatchAnswer {
  const failure = dispatchFailureOf(response);
  if (failure !== undefined) return { ok: false, error: failure };
  return {
    ok: true,
    emitted: response.emittedEvents.map((e) => (e.payload === undefined ? { event: e.event } : { event: e.event, payload: e.payload })),
  };
}

function jsonKind(value: EventPayloadValue | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'string';
  return typeof value;
}

function isPayloadRecord(v: EventPayloadValue | undefined): v is EventPayload {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** The value at an issue path (`a.b[0]`, `.` for the whole payload). */
function valueAt(root: EventPayloadValue, path: string): EventPayloadValue | undefined {
  if (path === '.') return root;
  let cur: EventPayloadValue | undefined = root;
  for (const part of path.split('.')) {
    const m = /^(.*?)((?:\[\d+\])*)$/.exec(part);
    const key = m?.[1] ?? part;
    if (!isPayloadRecord(cur)) return undefined;
    cur = cur[key];
    for (const idx of (m?.[2] ?? '').match(/\d+/g) ?? []) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(idx)];
    }
  }
  return cur;
}

/** Each wrong-type issue gains the kind of value that was sent. */
function withReceived(issues: readonly PayloadIssue[], value: EventPayloadValue): DispatchIssue[] {
  return issues.map((issue) => {
    if (issue.reason !== 'wrong-type') return issue;
    const received = jsonKind(valueAt(value, issue.path));
    return received === undefined ? issue : { ...issue, received };
  });
}

type Arguments = { readonly ok: true; readonly payload: EventPayload } | { readonly ok: false };

/** The arguments of a dispatch: absent or empty text is no payload, text is JSON, an object is itself. */
function argumentsOf(raw: JsonValue | undefined): Arguments | string {
  if (raw === undefined || raw === null) return { ok: true, payload: {} };
  if (typeof raw === 'string') {
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(raw === '' ? '{}' : raw);
    } catch {
      return { ok: false };
    }
    const checked = EventPayloadSchema.safeParse(parsed);
    return checked.success ? { ok: true, payload: checked.data } : { ok: false };
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const checked = EventPayloadSchema.safeParse(raw);
    return checked.success ? { ok: true, payload: checked.data } : { ok: false };
  }
  return 'program/dispatch: the arguments must be an object or JSON text';
}


/** The event-request options of a `program/dispatch` (owner, 2026-10-21): what the HTTP dispatch routes carry. */
export const DISPATCH_REQUEST_OPTIONS = [
  'wire', 'stream', 'input', 'orbital', 'targetTrait', 'entityId', 'event', 'traits', 'mount', 'clientId', 'locale',
  'delivery', 'dispatchLog', 'viewer',
] as const;

function isRecord(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOfRecords(value: JsonValue, required: readonly string[], optional: readonly string[]): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((item) => isRecord(item)
    && required.every((key) => typeof item[key] === 'string')
    && Object.entries(item).every(([key, v]) => required.includes(key) || (optional.includes(key) && typeof v === 'string')));
}

function requestOptionError(key: string, value: JsonValue): string | undefined {
  let ok: boolean;
  switch (key) {
    case 'wire': case 'stream': case 'input': ok = typeof value === 'boolean'; break;
    case 'orbital': case 'event': ok = typeof value === 'string' && value !== ''; break;
    case 'targetTrait': case 'entityId': case 'clientId': case 'locale': ok = typeof value === 'string'; break;
    case 'traits': ok = value === null || listOfRecords(value, ['trait', 'from'], ['event']); break;
    case 'mount': ok = listOfRecords(value, ['trait', 'event'], []); break;
    case 'delivery': case 'dispatchLog': case 'viewer': ok = value === null || isRecord(value); break;
    default: return `program/dispatch: unsupported option "${key}"`;
  }
  return ok ? undefined : `program/dispatch: option "${key}" has the wrong shape`;
}

type DispatchOptions = { readonly contract?: readonly PayloadField[]; readonly request: { [key: string]: JsonValue } };

function dispatchOptions(raw: JsonValue | undefined): DispatchOptions | string {
  if (raw === undefined || raw === null) return { request: {} };
  if (!isRecord(raw)) return 'program/dispatch: the options must be an object';
  const request: { [key: string]: JsonValue } = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'schema') continue;
    const error = requestOptionError(key, value);
    if (error !== undefined) return error;
    request[key] = value;
  }
  if (request['stream'] === true && request['wire'] !== true) return 'program/dispatch: stream items are part of the wire answer: stream needs wire';
  if (Object.keys(request).length > 0 && !('orbital' in request && 'event' in request)) return 'program/dispatch: an event request names its orbital and event';
  const schema = raw['schema'];
  if (schema === undefined) return { request };
  const checked = PayloadFieldSchema.array().safeParse(schema);
  return checked.success ? { contract: checked.data, request } : 'program/dispatch: schema must be a list of payload fields';
}

const INBOUND_SHAPE = 'program/dispatch: an inbound delivery is { inbound: name, body?: text, headers?: { name: text } }';

async function inbound(options: { [key: string]: JsonValue }, host: ServiceHostPorts): Promise<AgentPortOutcome> {
  if (Object.keys(options).some((key) => !['inbound', 'body', 'headers'].includes(key))) return fail(INBOUND_SHAPE);
  const name = options['inbound'];
  if (typeof name !== 'string' || name === '') return fail(INBOUND_SHAPE);
  const body = options['body'] ?? '';
  if (typeof body !== 'string') return fail(INBOUND_SHAPE);
  const rawHeaders = options['headers'] ?? {};
  if (!isRecord(rawHeaders)) return fail(INBOUND_SHAPE);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (typeof value !== 'string') return fail(INBOUND_SHAPE);
    headers[key] = value;
  }
  if (host.deliverInbound === undefined) return fail('program/dispatch: this host does not deliver inbound requests');
  const answer = await host.deliverInbound(name, { headers, rawBody: body });
  return { ok: true, result: { status: answer.status, body: answer.body } };
}

/** An empty text, record or list in an event request is absent, as the HTTP routes read it. */
function present(value: JsonValue | undefined): value is JsonValue {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

async function eventRequest(address: string, payload: EventPayload, request: { [key: string]: JsonValue }, host: ServiceHostPorts): Promise<AgentPortOutcome> {
  const text = (key: string): string => { const v = request[key]; return typeof v === 'string' ? v : ''; };
  const named = `${text('orbital')}.${text('targetTrait')}.${text('event')}`;
  if (address !== named) return fail(`program/dispatch: the address '${address}' is not the request's '${named}'`);
  if (host.dispatchRequest === undefined) return fail('program/dispatch: this host does not serve event requests');
  if (request['stream'] === true && host.supportsDispatchStream !== true) return fail('program/dispatch: this host does not answer stream items');
  const fields: Record<string, JsonValue | EventPayload> = { event: text('event'), payload };
  for (const key of ['entityId', 'targetTrait', 'clientId', 'locale', 'delivery', 'dispatchLog', 'mount']) {
    const value = request[key];
    if (present(value)) fields[key] = value;
  }
  if (request['traits'] !== undefined && request['traits'] !== null) fields['traits'] = request['traits'];
  if (isRecord(request['viewer'])) fields['user'] = request['viewer'];
  const parsed = OrbitalEventRequestSchema.safeParse(fields);
  if (!parsed.success) {
    const message = `program/dispatch: not an event request: ${parsed.error.message}`;
    return fail(message, [{ code: 'INVALID_REQUEST', message, status: 400 }]);
  }
  const answered = await host.dispatchRequest(text('orbital'), parsed.data, request['input'] === true, request['stream'] === true);
  if (!answered.ok) return fail(answered.error, [{ code: answered.code, message: answered.error, status: answered.status }]);
  if (request['wire'] !== true) return { ok: true, result: dispatchOutcomeOf(answered.response) };
  if (request['stream'] === true) return answered.streamItems === undefined
    ? fail('program/dispatch: this host does not answer stream items')
    : { ok: true, result: { ...answered.response, items: answered.streamItems } };
  return { ok: true, result: answered.response };
}

type Selection = { readonly event: string; readonly payload?: readonly PayloadField[] };

const SELECT_SHAPE = 'program/inputs: select must be a list of { event, payload? }';

function selectOption(raw: JsonValue | undefined): readonly Selection[] | string {
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'program/inputs: the options must be an object';
  for (const key of Object.keys(raw)) {
    if (!['select', 'state', 'stats', 'trace'].includes(key)) return `program/inputs: unsupported option "${key}"`;
  }
  const select = raw['select'];
  if (select === undefined) return [];
  if (!Array.isArray(select)) return SELECT_SHAPE;
  const chosen: Selection[] = [];
  for (const entry of select) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return SELECT_SHAPE;
    if (Object.keys(entry).some((key) => key !== 'event' && key !== 'payload')) return SELECT_SHAPE;
    const event = entry['event'];
    if (typeof event !== 'string') return SELECT_SHAPE;
    const payload = entry['payload'];
    if (payload === undefined) {
      chosen.push({ event });
      continue;
    }
    const checked = PayloadFieldSchema.array().safeParse(payload);
    if (!checked.success) return 'program/inputs: a select payload must be a list of payload fields';
    chosen.push({ event, payload: checked.data });
  }
  return chosen;
}

/**
 * `program/inputs`: every declared input, the persisted entities `persist/read-named` accepts, and — for an
 * optional `{ select: [{ event, payload? }] }` — the inputs those addresses name, in order, each with the stated
 * payload in place of its own.
 */
/** The `trace` step count of a `program/inputs`'s options; `state` and `stats` are read by the kernel only. */
function traceOption(raw: JsonValue | undefined): number | undefined | string {
  if (!isRecord(raw)) return undefined;
  const state = raw['state'];
  if (state !== undefined && (typeof state !== 'string' || state === '')) return 'program/inputs: state must name an orbital';
  const stats = raw['stats'];
  if (stats !== undefined && typeof stats !== 'boolean') return 'program/inputs: stats must be true or false';
  if (state !== undefined || stats === true) return 'program/inputs: state and stats are read by the kernel, not asked of the host';
  const trace = raw['trace'];
  if (trace === undefined) return undefined;
  if (typeof trace !== 'number' || trace < 0 || !Number.isInteger(trace)) return 'program/inputs: trace must be a whole number of steps';
  return trace;
}

function inputs(args: readonly JsonValue[], host: ServiceHostPorts): AgentPortOutcome {
  if (args.length > 1) return fail('program/inputs: takes only options');
  const chosen = selectOption(args[0]);
  if (typeof chosen === 'string') return fail(chosen);
  const steps = traceOption(args[0]);
  if (typeof steps === 'string') return fail(steps);
  if (steps !== undefined && host.trace === undefined) return fail('program/inputs: this host keeps no dispatch trace');
  const raw = args[0];
  if (steps !== undefined && isRecord(raw) && Object.keys(raw).length === 1 && host.trace !== undefined) {
    return { ok: true, result: host.trace(steps) };
  }
  const declared = host.inputs();
  const selected: ReflectedInput[] = [];
  for (const choice of chosen) {
    const input = findInputByAddress(declared, choice.event, host.caller);
    if (input === undefined) return fail(`program/inputs: '${choice.event}' is not a declared external input`);
    selected.push(reflectInput(input, choice.payload));
  }
  const reflection: AgentReflection = { inputs: declared.map((input) => reflectInput(input)), entities: host.readableEntities(), selected };
  if (steps !== undefined && host.trace !== undefined) reflection.trace = host.trace(steps);
  return { ok: true, result: reflection };
}

async function dispatch(args: readonly JsonValue[], host: ServiceHostPorts): Promise<AgentPortOutcome> {
  const [first] = args;
  if (args.length === 1 && isRecord(first) && 'inbound' in first) return inbound(first, host);
  if (args.length < 1 || args.length > 3) return fail('program/dispatch: expected an address, its arguments and optional options');
  const [address, rawArguments, rawOptions] = args;
  if (typeof address !== 'string') return fail('program/dispatch: the address must be text');
  const options = dispatchOptions(rawOptions);
  if (typeof options === 'string') return fail(options);
  const contract = options.contract;
  const parsed = argumentsOf(rawArguments);
  if (typeof parsed === 'string') return fail(parsed);
  if (Object.keys(options.request).length > 0) {
    if (!parsed.ok) return refusal(REFUSED_ARGUMENTS);
    if (contract !== undefined) {
      const issues = payloadIssues(contract, parsed.payload);
      if (issues.length > 0) return refusal(MISMATCHED_ARGUMENTS, withReceived(issues, parsed.payload));
    }
    return eventRequest(address, parsed.payload, options.request, host);
  }
  const input = findInputByAddress(host.inputs(), address, host.caller);
  if (input === undefined) return refusal(`'${address}' is not a declared external input`);
  if (!parsed.ok) return refusal(REFUSED_ARGUMENTS);
  if (contract !== undefined) {
    const issues = payloadIssues(contract, parsed.payload);
    if (issues.length > 0) return refusal(MISMATCHED_ARGUMENTS, withReceived(issues, parsed.payload));
  }
  const response = await host.dispatchInput(input.orbital, { targetTrait: input.trait, event: input.event, payload: parsed.payload });
  return { ok: true, result: dispatchOutcomeOf(response) };
}

async function readNamed(args: readonly JsonValue[], host: ServiceHostPorts): Promise<AgentPortOutcome> {
  if (args.length !== 1) return fail('persist/read-named: expected the entity name');
  const [name] = args;
  if (typeof name !== 'string') return fail('persist/read-named: the entity name must be text');
  if (!host.readableEntities().includes(name)) {
    const message = `persist/read-named: '${name}' is not a persisted entity of this program`;
    return fail(message, [{ code: UNKNOWN_ENTITY_CODE, message }]);
  }
  const rows: EntityRow[] = orderRows(await host.read(name), undefined);
  return { ok: true, result: { entity: name, count: rows.length, rows } };
}

/**
 * Run one agent-port operator (its positional arguments, the trailing `{ emit }` already split off) over
 * the host ports lent to the call. Failures come back as data, never thrown.
 */
export async function runAgentPort(op: AgentPortOperator, args: readonly JsonValue[], host: ServiceHostPorts): Promise<AgentPortOutcome> {
  switch (op) {
    case 'program/inputs':
      return inputs(args, host);
    case 'program/dispatch':
      return dispatch(args, host);
    case 'persist/read-named':
      return readNamed(args, host);
  }
}
