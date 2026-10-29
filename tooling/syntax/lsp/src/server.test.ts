import { describe, it, expect, vi, afterEach } from 'vitest';
import { jsonPathToPosition } from './json-path.js';
import { diagnosticFor } from './diagnostic.js';
import { DiagnosticSeverity } from 'vscode-languageserver/node';
import { resolveOrbBinary } from './binary-resolution.js';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ROOT = path.resolve(__dirname, '../../../../../../..');
// lsp/'s own package dir — running npx with this as cwd lets it resolve
// @almadar/orb from lsp/node_modules directly instead of falling back to a
// slow registry/npx-cache lookup (ROOT has no local @almadar/orb install).
const LSP_ROOT = path.resolve(__dirname, '..');

// ============================================================================
// Unit tests for jsonPathToPosition
// ============================================================================

describe('jsonPathToPosition', () => {
    const simpleJson = `{
  "name": "test",
  "orbitals": [
    {
      "name": "First",
      "traits": [
        {
          "name": "TraitA"
        }
      ]
    }
  ]
}`;

    it('should return line 0 for empty path', () => {
        const pos = jsonPathToPosition(simpleJson, '');
        expect(pos.line).toBe(0);
        expect(pos.character).toBe(0);
    });

    it('should find top-level key "name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'name');
        expect(pos.line).toBe(1);
    });

    it('should find "orbitals" key', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals');
        expect(pos.line).toBe(2);
    });

    it('should find first orbital by index', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0]');
        expect(pos.line).toBe(3);
    });

    it('should find nested key "orbitals[0].name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0].name');
        expect(pos.line).toBe(4);
    });

    it('should find deeply nested "orbitals[0].traits[0].name"', () => {
        const pos = jsonPathToPosition(simpleJson, 'orbitals[0].traits[0].name');
        expect(pos.line).toBe(7);
    });
});

// ============================================================================
// Unit tests for resolveOrbBinary (binary-resolution.ts)
// ============================================================================

function writeFakeExecutable(filePath: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

describe('resolveOrbBinary', () => {
    const KEYS = ['PATH', 'ORB_BIN'] as const;
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    let tmpBase: string | undefined;

    function setup(): { dir: string; home: string; pathDir: string } {
        tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'orb-lsp-test-'));
        const home = path.join(tmpBase, 'home');
        const pathDir = path.join(tmpBase, 'path-bin');
        fs.mkdirSync(home, { recursive: true });
        fs.mkdirSync(pathDir, { recursive: true });
        process.env.PATH = `${pathDir}:/usr/bin:/bin`;
        delete process.env.ORB_BIN;
        return { dir: tmpBase, home, pathDir };
    }

    afterEach(() => {
        for (const k of KEYS) {
            const value = saved[k];
            if (value === undefined) delete process.env[k]; else process.env[k] = value;
        }
        if (tmpBase) fs.rmSync(tmpBase, { recursive: true, force: true });
        tmpBase = undefined;
    });

    it('the editor\'s orbBin wins over the orb core would find', () => {
        const { dir, home, pathDir } = setup();
        const configured = path.join(dir, 'orb-configured');
        writeFakeExecutable(configured);
        writeFakeExecutable(path.join(pathDir, 'orb'));
        expect(resolveOrbBinary({ orbBin: configured, homedir: () => home })).toEqual({ path: configured, strategy: 'editor orbBin' });
    });

    it('ORB_BIN in the environment wins over the editor\'s orbBin', () => {
        const { dir, home } = setup();
        const configured = path.join(dir, 'orb-configured');
        writeFakeExecutable(configured);
        process.env.ORB_BIN = path.join(dir, 'orb-env');
        writeFakeExecutable(process.env.ORB_BIN);
        expect(resolveOrbBinary({ orbBin: configured, homedir: () => home })?.path).toBe(process.env.ORB_BIN);
    });

    it('edge: an orbBin that does not exist is refused by name, never skipped', () => {
        const { dir, home, pathDir } = setup();
        writeFakeExecutable(path.join(pathDir, 'orb'));
        const missing = path.join(dir, 'does-not-exist');
        const warnings: string[] = [];
        expect(resolveOrbBinary({ orbBin: missing, homedir: () => home, logger: { warn: (m) => warnings.push(m) } })).toBeNull();
        expect(warnings.join('\n')).toContain(missing);
    });

    it('without configuration it uses the @almadar/orb installed for the workspace', () => {
        const { dir, home, pathDir } = setup();
        writeFakeExecutable(path.join(pathDir, 'orb'));
        const pkg = path.join(dir, 'workspace', 'node_modules', '@almadar', 'orb');
        fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
        fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@almadar/orb', bin: { orb: 'bin/orb' } }));
        writeFakeExecutable(path.join(pkg, 'bin', 'orb'));
        const result = resolveOrbBinary({ workspaceRoot: path.join(dir, 'workspace'), homedir: () => home });
        expect(result).toEqual({ path: path.join(pkg, 'bin', 'orb'), strategy: '@almadar/core resolveOrbBinary' });
    });

    it('control: an orb on PATH is not picked up when nothing is configured or installed', () => {
        const { home, pathDir } = setup();
        writeFakeExecutable(path.join(pathDir, 'orb'));
        const warnings: string[] = [];
        expect(resolveOrbBinary({ homedir: () => home, logger: { warn: (m) => warnings.push(m) } })).toBeNull();
        expect(warnings.join('\n')).toContain('set ORB_BIN or install @almadar/orb');
    });

    it('returns null, with the reason, when nothing resolves', () => {
        const { home } = setup();
        const warnings: string[] = [];
        expect(resolveOrbBinary({ homedir: () => home, logger: { warn: (m) => warnings.push(m) } })).toBeNull();
        expect(warnings.join('\n')).toContain('orb');
    });
});

// ============================================================================
// CLI integration tests
// ============================================================================

describe('orb validate CLI', () => {
    const schemasDir = path.join(ROOT, 'almadar', 'tests', 'schemas');

    // Use npx to run @almadar/orb (the binary isn't in node_modules/.bin).
    // @almadar/cli (bin: "almadar") is a separate, stale, unmaintained
    // package predating .lolo support — @almadar/orb (bin: "orb") is the
    // actively-published CLI and the one resolveOrbBinary() targets.
    function runValidate(schemaPath: string): string {
        return execFileSync('npx', ['-y', '@almadar/orb', 'validate', '--json', schemaPath], {
            cwd: LSP_ROOT,
            encoding: 'utf-8',
            timeout: 30_000,
        });
    }

    it('should validate a valid schema with no errors', () => {
        const schemaPath = path.join(schemasDir, '02-state-machine.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.errors).toBeUndefined();
    });

    it('should produce warnings for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        expect(result.valid).toBe(true);
        expect(result.warnings).toBeDefined();
        expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should produce warnings with JSON paths for guards schema', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        for (const w of result.warnings) {
            expect(w.code).toBeDefined();
            expect(w.path).toBeDefined();
            expect(w.message).toBeDefined();
        }
    });

    it('should produce errors for invalid JSON', () => {
        const tmpFile = path.join(ROOT, '__test_invalid.orb');
        try {
            fs.writeFileSync(tmpFile, '{ "name": "bad" }', 'utf-8');
            const stdout = runValidate(tmpFile);
            const result = JSON.parse(stdout);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            expect(result.errors.length).toBeGreaterThan(0);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    });

    it('should map warning paths to correct line positions', () => {
        const schemaPath = path.join(schemasDir, '03-guards.orb');
        const content = fs.readFileSync(schemaPath, 'utf-8');
        const stdout = runValidate(schemaPath);
        const result = JSON.parse(stdout);
        const firstWarning = result.warnings[0];
        const pos = jsonPathToPosition(content, firstWarning.path);

        // The position should be on a line that exists in the file
        const lines = content.split('\n');
        expect(pos.line).toBeLessThan(lines.length);
        expect(pos.line).toBeGreaterThan(0);
    });

    // A .lolo parse error carries a real "<input>:LINE:COL" source locator
    // (not a JSON-pointer path) — server.ts's LOLO_SOURCE_POS regex parses
    // this directly instead of routing it through jsonPathToPosition.
    it('should produce a LOLO_PARSE_ERROR with an <input>:LINE:COL path for invalid .lolo source', () => {
        const tmpFile = path.join(ROOT, '__test_invalid.lolo');
        try {
            fs.writeFileSync(tmpFile, 'app Test "desc"\n\norbital Foo\n  entity Foo\n    field id: string\n', 'utf-8');
            const stdout = runValidate(tmpFile);
            const result = JSON.parse(stdout);
            expect(result.valid).toBe(false);
            expect(result.errors).toBeDefined();
            const err = result.errors[0];
            expect(err.code).toBe('LOLO_PARSE_ERROR');
            expect(err.path).toMatch(/^<input>:\d+:\d+$/);
        } finally {
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    });
});

describe('diagnosticFor', () => {
    const source = 'app probe [ version: "1.0.0" ]\norbital Probe {\n  entity Item [runtime] {}\n}\n';
    const item = { code: 'ORB_X', path: 'orbitals.Probe', message: 'broken', suggestion: 'fix it' };

    it('underlines exactly the span the CLI reports', () => {
        const d = diagnosticFor(source, { ...item, line: 3, column: 3, endLine: 3, endColumn: 9 }, DiagnosticSeverity.Error);
        expect(d.range).toEqual({ start: { line: 2, character: 2 }, end: { line: 2, character: 8 } });
        expect(d.severity).toBe(DiagnosticSeverity.Error);
        expect(d.message).toBe('broken\n💡 fix it');
    });

    it('turns an approximate span into a hint', () => {
        const d = diagnosticFor(source, { ...item, line: 2, column: 1, endLine: 2, endColumn: 8, approximate: true }, DiagnosticSeverity.Warning);
        expect(d.severity).toBe(DiagnosticSeverity.Hint);
        expect(d.range.end).toEqual({ line: 1, character: 7 });
    });

    it('control: a finding with no span keeps its path position and its severity', () => {
        const d = diagnosticFor('{\n  "name": "t"\n}', { code: 'C', path: 'name', message: 'm' }, DiagnosticSeverity.Warning);
        expect(d.severity).toBe(DiagnosticSeverity.Warning);
        expect(d.range.start.line).toBe(1);
        expect(d.range.end.character).toBe('  "name": "t"'.length);
    });
});
