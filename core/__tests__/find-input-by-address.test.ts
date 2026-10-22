// A `call-tools` tool names an input with `listens` addressing, resolved from the
// calling trait's position: `EVENT` (its own trait), `Trait.EVENT` (its orbital),
// `Orbital.Trait.EVENT` (any orbital). Only declared external inputs resolve.
import { describe, it, expect } from 'vitest';
import { findInputByAddress, type ExternalInput } from '../index';

const inputs: ExternalInput[] = [
  { orbital: 'TaskOrbital', trait: 'TaskPersistor', event: 'DO_CREATE', payloadSchema: [] },
  { orbital: 'LeadOrbital', trait: 'LeadOrbitalDealPersistor', event: 'DO_UPDATE', payloadSchema: [] },
  { orbital: 'TaskOrbital', trait: 'Assistant', event: 'ASK', payloadSchema: [] },
];
const caller = { orbital: 'TaskOrbital', trait: 'Assistant' };

describe('findInputByAddress', () => {
  it('resolves a trait address within the caller orbital', () => {
    expect(findInputByAddress(inputs, 'TaskPersistor.DO_CREATE', caller)?.event).toBe('DO_CREATE');
  });

  it('resolves an orbital address anywhere in the program', () => {
    expect(findInputByAddress(inputs, 'LeadOrbital.LeadOrbitalDealPersistor.DO_UPDATE', caller)?.trait).toBe(
      'LeadOrbitalDealPersistor',
    );
  });

  it('resolves a bare event on the caller trait', () => {
    expect(findInputByAddress(inputs, 'ASK', caller)?.trait).toBe('Assistant');
  });

  it('a trait address does not reach a sibling orbital', () => {
    expect(findInputByAddress(inputs, 'LeadOrbitalDealPersistor.DO_UPDATE', caller)).toBeUndefined();
  });

  it('control: an event that is not a declared input does not resolve', () => {
    expect(findInputByAddress(inputs, 'TaskPersistor.OPEN', caller)).toBeUndefined();
  });

  it('a wildcard is not an address', () => {
    expect(findInputByAddress(inputs, '*.DO_CREATE', caller)).toBeUndefined();
  });
});
