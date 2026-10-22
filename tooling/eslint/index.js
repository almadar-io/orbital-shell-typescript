"use strict";

const noRawDomElements = require("./rules/no-raw-dom-elements");
const templateNoHooks = require("./rules/template-no-hooks");
const templateNoCallbacks = require("./rules/template-no-callbacks");
const templateNoLocalVariables = require("./rules/template-no-local-variables");
const templateNoIteration = require("./rules/template-no-iteration");
const templateSerializableProps = require("./rules/template-serializable-props");
const noTypeProp = require("./rules/no-type-prop");
const noAsAny = require("./rules/no-as-any");
const noAsUnknownAs = require("./rules/no-as-unknown-as");
const noUnknownType = require("./rules/no-unknown-type");
const noRecordStringUnknown = require("./rules/no-record-string-unknown");
const noEntityStringType = require("./rules/no-entity-string-type");
const noImportGenerated = require("./rules/no-import-generated");
const noUseNavigate = require("./rules/no-use-navigate");
const requireEventBus = require("./rules/require-event-bus");
const requireDisplayName = require("./rules/require-display-name");
const requireClosedCircuitProps = require("./rules/require-closed-circuit-props");
const requireStories = require("./rules/require-stories");
const eventNamingConvention = require("./rules/event-naming-convention");
const templateExtendsBase = require("./rules/template-extends-base");
const requireTranslate = require("./rules/require-translate");
const organismNoDataState = require("./rules/organism-no-data-state");
const organismNoAutoFetch = require("./rules/organism-no-auto-fetch");
const organismNoCallbackProps = require("./rules/organism-no-callback-props");
const organismExtendsEntityDisplay = require("./rules/organism-extends-entity-display");
const organismRenderingStateOnly = require("./rules/organism-rendering-state-only");
const organismRequireEntityRow = require("./rules/organism-require-entity-row");

// Atom/molecule rules
const atomMoleculeNoEntityProp = require("./rules/atom-molecule-no-entity-prop");

// Theme rules
const noHardcodedColors = require("./rules/no-hardcoded-colors");

// Behavior rules
const behaviorNoOrganisms = require("./rules/behavior-no-organisms");

// Service rules - Phase 1-3 (Implemented)
const serviceLazySingleton = require("./rules/service-lazy-singleton");
const serviceSingletonResettable = require("./rules/service-singleton-resettable");
const serviceNoModuleSideEffects = require("./rules/service-no-module-side-effects");
const serviceEventbusSingleton = require("./rules/service-eventbus-singleton");
const serviceEventNameScreaming = require("./rules/service-event-name-screaming");
const serviceIntegrationExtendsBase = require("./rules/service-integration-extends-base");
const serviceStoreIsolation = require("./rules/service-store-isolation");

// Service rules - Phase 4 (New)
const serviceBarrelComplete = require("./rules/service-barrel-complete");
const serviceSubpathMatchTsup = require("./rules/service-subpath-match-tsup");
const serviceNoWorkspaceRefs = require("./rules/service-no-workspace-refs");
const serviceExternalDeclared = require("./rules/service-external-declared");

// Service rules - Additional (New)
const serviceUseEventbus = require("./rules/service-use-eventbus");
const serviceNoInlineQueries = require("./rules/service-no-inline-queries");

const plugin = {
  meta: {
    name: "@almadar/eslint-plugin",
    version: "2.1.0",
  },

  rules: {
    "no-raw-dom-elements": noRawDomElements,
    "template-no-hooks": templateNoHooks,
    "template-no-callbacks": templateNoCallbacks,
    "template-no-local-variables": templateNoLocalVariables,
    "template-no-iteration": templateNoIteration,
    "template-serializable-props": templateSerializableProps,
    "no-type-prop": noTypeProp,
    "no-as-any": noAsAny,
    "no-as-unknown-as": noAsUnknownAs,
    "no-unknown-type": noUnknownType,
    "no-record-string-unknown": noRecordStringUnknown,
    "no-entity-string-type": noEntityStringType,
    "no-import-generated": noImportGenerated,
    "no-use-navigate": noUseNavigate,
    "require-event-bus": requireEventBus,
    "require-display-name": requireDisplayName,
    "require-closed-circuit-props": requireClosedCircuitProps,
    "require-stories": requireStories,
    "event-naming-convention": eventNamingConvention,
    "template-extends-base": templateExtendsBase,
    "require-translate": requireTranslate,
    "organism-no-data-state": organismNoDataState,
    "organism-no-auto-fetch": organismNoAutoFetch,
    "organism-no-callback-props": organismNoCallbackProps,
    "organism-extends-entity-display": organismExtendsEntityDisplay,
    "organism-rendering-state-only": organismRenderingStateOnly,
    "organism-require-entity-row": organismRequireEntityRow,

    // Atom/molecule rules
    "atom-molecule-no-entity-prop": atomMoleculeNoEntityProp,

    // Theme rules
    "no-hardcoded-colors": noHardcodedColors,

    // Behavior rules
    "behavior-no-organisms": behaviorNoOrganisms,

    // Service rules - Phase 1-3
    "service-lazy-singleton": serviceLazySingleton,
    "service-singleton-resettable": serviceSingletonResettable,
    "service-no-module-side-effects": serviceNoModuleSideEffects,
    "service-eventbus-singleton": serviceEventbusSingleton,
    "service-event-name-screaming": serviceEventNameScreaming,
    "service-integration-extends-base": serviceIntegrationExtendsBase,
    "service-store-isolation": serviceStoreIsolation,

    // Service rules - Phase 4
    "service-barrel-complete": serviceBarrelComplete,
    "service-subpath-match-tsup": serviceSubpathMatchTsup,
    "service-no-workspace-refs": serviceNoWorkspaceRefs,
    "service-external-declared": serviceExternalDeclared,

    // Service rules - Additional
    "service-use-eventbus": serviceUseEventbus,
    "service-no-inline-queries": serviceNoInlineQueries,
  },

  configs: {},
};

// Recommended config — all rules at their intended severity
plugin.configs.recommended = {
  plugins: {
    almadar: plugin,
  },
  rules: {
    // Error-level — breaks the pipeline or violates hard rules
    "almadar/no-raw-dom-elements": "error",
    "almadar/template-no-hooks": "error",
    "almadar/template-no-callbacks": "error",
    "almadar/template-no-local-variables": "error",
    "almadar/template-no-iteration": "error",
    "almadar/template-serializable-props": "error",
    "almadar/no-type-prop": "error",
    "almadar/no-as-any": "error",
    "almadar/no-as-unknown-as": "error",
    "almadar/no-unknown-type": "error",
    "almadar/no-record-string-unknown": "error",
    "almadar/no-entity-string-type": "error",
    "almadar/no-import-generated": "error",
    "almadar/no-use-navigate": "error",
    "almadar/atom-molecule-no-entity-prop": "error",
    "almadar/no-hardcoded-colors": "error",

    // Warn-level — conventions that should be followed
    "almadar/require-event-bus": "warn",
    "almadar/require-display-name": "warn",
    "almadar/require-closed-circuit-props": "warn",
    "almadar/require-stories": "warn",
    "almadar/event-naming-convention": "warn",
    "almadar/template-extends-base": "warn",
    "almadar/require-translate": "warn",

    // Behavior rules — restrict to atoms/molecules only
    "almadar/behavior-no-organisms": "error",

    // Organism rules — enforce dumb organism pattern
    "almadar/organism-no-data-state": "error",
    "almadar/organism-no-auto-fetch": "error",
    "almadar/organism-no-callback-props": "error",
    "almadar/organism-extends-entity-display": "error",
    "almadar/organism-rendering-state-only": "warn",
    "almadar/organism-require-entity-row": "error",
  },
};

// Strict config — everything as error
plugin.configs.strict = {
  plugins: {
    almadar: plugin,
  },
  rules: Object.fromEntries(
    Object.keys(plugin.rules).map((name) => [`almadar/${name}`, "error"])
  ),
};

// Templates-only config — just the template rules (for CI on design-system dirs)
plugin.configs.templates = {
  plugins: {
    almadar: plugin,
  },
  rules: {
    "almadar/template-no-hooks": "error",
    "almadar/template-no-callbacks": "error",
    "almadar/template-no-local-variables": "error",
    "almadar/template-no-iteration": "error",
    "almadar/template-serializable-props": "error",
    "almadar/template-extends-base": "error",
  },
};

// Organisms-only config — enforce dumb organism pattern
plugin.configs.organisms = {
  plugins: { almadar: plugin },
  rules: {
    "almadar/organism-no-data-state": "error",
    "almadar/organism-no-auto-fetch": "error",
    "almadar/organism-no-callback-props": "error",
    "almadar/organism-extends-entity-display": "error",
    "almadar/organism-rendering-state-only": "warn",
    "almadar/require-event-bus": "error",
    "almadar/require-closed-circuit-props": "error",
    "almadar/organism-require-entity-row": "error",
  },
};

// Services config — service package structure rules
plugin.configs.services = {
  plugins: { almadar: plugin },
  rules: {
    // Phase 1-3
    "almadar/service-lazy-singleton": "error",
    "almadar/service-singleton-resettable": "error",
    "almadar/service-no-module-side-effects": "error",
    "almadar/service-eventbus-singleton": "error",
    "almadar/service-event-name-screaming": "error",
    "almadar/service-integration-extends-base": "error",
    "almadar/service-store-isolation": "error",
    // Phase 4
    "almadar/service-barrel-complete": "warn",
    "almadar/service-subpath-match-tsup": "warn",
    "almadar/service-no-workspace-refs": "error",
    "almadar/service-external-declared": "error",
    // Additional
    "almadar/service-use-eventbus": "warn",
    "almadar/service-no-inline-queries": "error",
  },
};

// Services strict config — all service rules as error
plugin.configs["services-strict"] = {
  plugins: { almadar: plugin },
  rules: {
    // Phase 1-3
    "almadar/service-lazy-singleton": "error",
    "almadar/service-singleton-resettable": "error",
    "almadar/service-no-module-side-effects": "error",
    "almadar/service-eventbus-singleton": "error",
    "almadar/service-event-name-screaming": "error",
    "almadar/service-integration-extends-base": "error",
    "almadar/service-store-isolation": "error",
    // Phase 4
    "almadar/service-barrel-complete": "error",
    "almadar/service-subpath-match-tsup": "error",
    "almadar/service-no-workspace-refs": "error",
    "almadar/service-external-declared": "error",
    // Additional
    "almadar/service-use-eventbus": "error",
    "almadar/service-no-inline-queries": "error",
  },
};

// Behaviors config — lint .orb behavior schemas for pattern tier compliance
// Requires: jsonc-eslint-parser (pnpm add -D jsonc-eslint-parser)
// Usage in eslint.config.js: { files: ["**/*.orb"], ...almadar.configs.behaviors }
plugin.configs.behaviors = {
  plugins: { almadar: plugin },
  languageOptions: {
    parser: require("jsonc-eslint-parser"),
  },
  rules: {
    "almadar/behavior-no-organisms": "error",
  },
};

module.exports = plugin;
