/**
 * The endpoint protocol table (EXEC-ENDPOINT-1): the protocols a `page` can be written with, the record type of each
 * address, whether a viewer exists, the grant it needs and the side that serves it. `tsup` writes it to
 * `dist/language/protocols.json` (`orbLanguage.protocols`); `orb` reads it to lower, validate and mount protocol
 * pages, and a compiled client program carries it in `_metadata.protocols`. A protocol's behavior is std `.lolo`; a
 * row only declares it.
 *
 * @packageDocumentation
 */
import { z } from 'zod';

export const ProtocolSideSchema = z.enum(['client', 'server', 'process', 'start']);
export const ProtocolGrantSchema = z.enum(['net-listen', 'stdio']);

export const ProtocolAddressFieldSchema = z.strictObject({
  name: z.string().min(1),
  type: z.string().min(1),
  required: z.boolean(),
});

export const ProtocolSpecSchema = z.strictObject({
  name: z.string().min(1),
  address: z.array(ProtocolAddressFieldSchema).nullable(),
  viewer: z.boolean(),
  grant: ProtocolGrantSchema.nullable(),
  side: ProtocolSideSchema,
});

export type ProtocolSide = z.infer<typeof ProtocolSideSchema>;
export type ProtocolGrant = z.infer<typeof ProtocolGrantSchema>;
export type ProtocolAddressField = z.infer<typeof ProtocolAddressFieldSchema>;
export type ProtocolSpec = z.infer<typeof ProtocolSpecSchema>;

const HTTP_ADDRESS: ProtocolAddressField[] = [
  { name: 'host', type: 'string', required: true },
  { name: 'port', type: 'number', required: true },
  { name: 'path', type: 'string', required: false },
];

export const PROTOCOLS: readonly ProtocolSpec[] = [
  { name: 'route', address: null, viewer: true, grant: null, side: 'client' },
  { name: 'http', address: HTTP_ADDRESS, viewer: false, grant: 'net-listen', side: 'server' },
  { name: 'stdio', address: null, viewer: false, grant: 'stdio', side: 'process' },
  { name: 'boot', address: null, viewer: false, grant: null, side: 'start' },
];
