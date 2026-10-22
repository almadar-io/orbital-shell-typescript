/**
 * Typed questionnaire surface — derives open questions from a
 * `FactoryCallSite[]` plan + factory signature catalog, reduces
 * answers back into typed `FactoryCallPlanMutation[]`.
 *
 * Relocated from `@almadar-io/agent/analysis/questions/` — the
 * functions are pure transforms over `@almadar/core` factory types
 * and belong alongside them.
 */

export type {
  DomainQuestion,
  DomainQuestionAnswer,
  DomainQuestionAnswers,
  DomainQuestionInputType,
  FactoryCallPlanMutationTemplate,
  FactoryParamValue,
} from './types.js';
export { deriveInputType, factoryCallPlanOrbitalName, generateQuestions, humanizeKey } from './generate.js';
export { answerToMutations, answersToMutations } from './reducer.js';
