/**
 * Identity and owner facts that access policies read.
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
