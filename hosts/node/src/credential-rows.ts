import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { EntityRowSchema, runRowWrite, type EntityRow, type JsonValue } from '@almadar/core';
import type { CredentialRowsPort } from '@almadar/shell-runtime';

/** Where the credential rows live when no path is named: the file the native host reads (`FileCredentialRows`). */
const CREDENTIALS_FILE_ENV = 'ALMADAR_CREDENTIALS_FILE';
export const DEFAULT_CREDENTIALS_FILE = '.almadar/dev-credentials.json';

const CREDENTIAL_ROWS_ENTITY = 'AlmadarIntegrationCredential';

/** `ALMADAR_CREDENTIALS_FILE`, else `.almadar/dev-credentials.json` under the working directory, as the native host resolves it. */
export function credentialsFilePath(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  const named = env[CREDENTIALS_FILE_ENV];
  return named !== undefined && named !== '' ? named : join(cwd, DEFAULT_CREDENTIALS_FILE);
}

const gates = new Map<string, { tail: Promise<void> }>();

function gateOf(path: string): { tail: Promise<void> } {
  const held = gates.get(path);
  if (held !== undefined) return held;
  const gate = { tail: Promise.resolve() };
  gates.set(path, gate);
  return gate;
}

function isMissing(error: Error): boolean {
  return 'code' in error && error.code === 'ENOENT';
}

/**
 * The kernel's credential rows kept in a JSON file, the layout the native host writes: an array of rows each carrying an
 * `id`, written whole through a temporary file and a rename. A missing file is no rows; a file that cannot be read, is not
 * JSON, is not an array of rows or holds a row without an id is a failure. Operations here run one after another, so the
 * conditional delete is atomic against every other port over the same file in this process; a second process is not
 * covered, as with the native host.
 */
export function fileCredentialRows(path: string): CredentialRowsPort {
  const gate = gateOf(path);
  const read = async (): Promise<EntityRow[]> => {
    let text: string;
    try {
      text = await readFile(path, 'utf8');
    } catch (error) {
      if (error instanceof Error && isMissing(error)) return [];
      throw error;
    }
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`credential file ${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const rows = EntityRowSchema.array().safeParse(parsed);
    if (!rows.success) throw new Error(`credential file ${path} is not an array of rows: ${rows.error.message}`);
    const at = rows.data.findIndex((row) => typeof row.id !== 'string');
    if (at >= 0) throw new Error(`credential file ${path}: row ${at} carries no id`);
    return rows.data;
  };
  const write = async (rows: EntityRow[]): Promise<void> => {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    await writeFile(temporary, JSON.stringify(rows, null, 2));
    await rename(temporary, path);
  };
  const change = <T>(work: (rows: EntityRow[]) => { rows: EntityRow[]; result: T; changed: boolean }): Promise<T> => {
    const next = gate.tail.then(async () => {
      const { rows, result, changed } = work(await read());
      if (changed) await write(rows);
      return result;
    });
    gate.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    async list() {
      await gate.tail;
      return read();
    },
    create: (row) => change((rows) => ({ rows: [...rows, row], result: undefined, changed: true })),
    update: (id, data) =>
      change((rows) => ({
        rows: rows.map((row) => (row.id === id ? { ...row, ...data, id } : row)),
        result: undefined,
        changed: rows.some((row) => row.id === id),
      })),
    delete: (id) =>
      change((rows) => {
        const written = runRowWrite(rows, { kind: 'delete', entityType: CREDENTIAL_ROWS_ENTITY, id });
        const removed = written.outcome.kind === 'deleted';
        return { rows: written.rows, result: removed, changed: removed };
      }),
  };
}
