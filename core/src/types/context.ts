/**
 * Context Extensions (framework concept)
 *
 * Open interface for consumer-supplied context that flows through guards,
 * effects, and evaluation. Generated code imports `ContextExtensions`
 * instead of `Record<string, unknown>` / `unknown` for the extensions bag,
 * so downstream type-checking verifies that every read of a context key
 * lines up with a declared interface member.
 *
 * Declaration-merging pattern — consumers augment this interface with
 * their own optional fields:
 *
 * ```ts
 * declare module '@almadar/core' {
 *   interface ContextExtensions {
 *     agent?: AgentContext;
 *     auth?: AuthContext;
 *   }
 * }
 * ```
 *
 * With no augmentation the interface is `{}` — `ctx.extensions.foo` is
 * a type error, which is the desired behavior: if the codegen hits a
 * context field that nobody declared, the consumer project is expected
 * to add the declaration rather than widen to `unknown`.
 *
 * @packageDocumentation
 */

// Intentionally empty — consumers augment via `declare module '@almadar/core'`.
// See module docstring above for the declaration-merging pattern.
export interface ContextExtensions {}
