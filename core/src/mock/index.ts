/**
 * Identity and owner facts a mock store's seeding and policies read; sampling is the std-mock-seed program's.
 *
 * @packageDocumentation
 */

export {
  collectUserFieldLiterals,
  identityEntitiesOf,
  identityEntityName,
  identityEntityNames,
  ownerColumnsFromPolicy,
  ownerFieldsFromSchema,
  roleSatisfyingPolicy,
  roleVocabularyOf,
} from './identityOwners.js';
export {
  type EntityAccessPolicies,
  entityAccessPolicies,
  entityAccessPoliciesByStoreKey,
  entityAccessTable,
} from '../access/entityAccess.js';
