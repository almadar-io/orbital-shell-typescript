import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import { jsonPathToPosition } from './json-path.js';

/** The 1-based source span `orb validate --json` reports beside a finding's `path`. */
export interface SourceSpan {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
    approximate?: boolean;
}

export interface ValidateItem extends Partial<SourceSpan> {
    code: string;
    path: string;
    message: string;
    suggestion?: string;
}

/** An approximate span is only the nearest tracked source line, so it is a hint, not the finding's location. */
export function diagnosticFor(
    sourceContent: string,
    item: ValidateItem,
    severity: DiagnosticSeverity,
): Diagnostic {
    let message = item.message;
    if (item.suggestion) {
        message += `\n💡 ${item.suggestion}`;
    }
    const base = { message, source: 'orb', code: item.code };

    if (
        item.line !== undefined &&
        item.column !== undefined &&
        item.endLine !== undefined &&
        item.endColumn !== undefined
    ) {
        return {
            ...base,
            range: {
                start: { line: item.line - 1, character: item.column - 1 },
                end: { line: item.endLine - 1, character: item.endColumn - 1 },
            },
            severity: item.approximate ? DiagnosticSeverity.Hint : severity,
        };
    }

    const pos = jsonPathToPosition(sourceContent, item.path);
    const lineText = sourceContent.split('\n')[pos.line] ?? '';
    return {
        ...base,
        range: {
            start: { line: pos.line, character: pos.character },
            end: { line: pos.line, character: lineText.length },
        },
        severity,
    };
}
