import fs from 'node:fs';
import path from 'node:path';
import { projectRuntimeContract } from './runtime-contract-projection.js';
import type { PatternsRegistry } from '../src/patterns/index.js';

const dir = path.resolve(import.meta.dirname, '../src/patterns');
const registry: PatternsRegistry = JSON.parse(fs.readFileSync(path.join(dir, 'patterns-registry.json'), 'utf8'));
fs.writeFileSync(path.join(dir, 'patterns-runtime-contract.json'), `${JSON.stringify(projectRuntimeContract(registry))}\n`);
