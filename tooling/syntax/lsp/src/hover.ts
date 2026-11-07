/**
 * `.lolo` hover: the operator at the head of an s-expression call, described from `orb signatures`.
 * No `connection` dependency, so it's directly unit-testable.
 */
import type { Hover, Position } from 'vscode-languageserver/node';

export interface SignatureType {
    kind: string;
    name?: string;
    of?: SignatureType | SignatureType[] | string;
    value?: string;
    params?: SignatureType[];
    returns?: SignatureType | string;
}

export interface OperatorParam {
    name: string;
    description?: string;
    type?: SignatureType;
}

export interface OperatorSignature {
    description?: string;
    minArity?: number;
    maxArity?: number;
    params?: OperatorParam[];
    returnType?: SignatureType;
    examples?: string[];
}

export interface Signatures {
    operators: Record<string, OperatorSignature>;
}

export function parseSignatures(stdout: string): Signatures {
    const parsed: Signatures = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.operators !== 'object' || parsed.operators === null) {
        throw new Error('orb signatures: no operators');
    }
    return parsed;
}

const HEAD_CHAR = /[A-Za-z0-9_/\-?!*+<>=.%]/;

/** The call head the offset sits on: the token right after an opening paren. */
export function callHeadAt(text: string, offset: number): { name: string; start: number; end: number } | undefined {
    let start = Math.min(offset, text.length);
    while (start > 0 && HEAD_CHAR.test(text[start - 1])) start -= 1;
    let end = Math.min(offset, text.length);
    while (end < text.length && HEAD_CHAR.test(text[end])) end += 1;
    if (start === end || start === 0 || text[start - 1] !== '(') return undefined;
    return { name: text.slice(start, end), start, end };
}

function typeText(type: SignatureType | string | undefined): string {
    if (type === undefined) return '';
    if (typeof type === 'string') return type;
    switch (type.kind) {
        case 'var':
            return type.name ?? 'T';
        case 'array':
            return `${typeText(Array.isArray(type.of) ? undefined : type.of)}[]`;
        case 'union':
            return Array.isArray(type.of) ? type.of.map((t) => typeText(t)).join(' | ') : type.kind;
        case 'keyOf':
            return `keyOf ${typeof type.of === 'string' ? type.of : typeText(Array.isArray(type.of) ? undefined : type.of)}`;
        case 'fn':
            return `(fn ${(type.params ?? []).map((p) => typeText(p)).join(' ')} -> ${typeText(type.returns)})`;
        default:
            return type.kind;
    }
}

function arityText(sig: OperatorSignature): string {
    if (sig.minArity === undefined || sig.maxArity === undefined) return '';
    return sig.minArity === sig.maxArity ? `${sig.minArity}` : `${sig.minArity}-${sig.maxArity}`;
}

export function operatorMarkdown(name: string, sig: OperatorSignature): string {
    const params = sig.params ?? [];
    const arity = arityText(sig);
    const lines = [
        `**${name}**${arity ? ` (${arity} args)` : ''}`,
        ...(sig.description !== undefined ? ['', sig.description] : []),
        ...(params.length > 0 ? ['', ...params.map((p) => `- \`${p.name}\`${p.type ? `: ${typeText(p.type)}` : ''}${p.description ? ` — ${p.description}` : ''}`)] : []),
        ...(sig.returnType ? ['', `Returns \`${typeText(sig.returnType)}\``] : []),
        ...(sig.examples && sig.examples.length > 0 ? ['', '```lolo', ...sig.examples, '```'] : []),
    ];
    return lines.join('\n');
}

/** Hover for the call head at `offset`; none when the cursor is elsewhere or the head names no operator. */
export function hoverFor(signatures: Signatures, text: string, offset: number, position: Position): Hover | undefined {
    const head = callHeadAt(text, offset);
    if (head === undefined || !Object.prototype.hasOwnProperty.call(signatures.operators, head.name)) return undefined;
    const width = head.end - head.start;
    return {
        contents: { kind: 'markdown', value: operatorMarkdown(head.name, signatures.operators[head.name]) },
        range: {
            start: { line: position.line, character: position.character - (offset - head.start) },
            end: { line: position.line, character: position.character - (offset - head.start) + width },
        },
    };
}
