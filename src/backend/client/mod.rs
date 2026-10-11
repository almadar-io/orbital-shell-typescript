//! Client-side TypeScript generation (React hooks, components, pages bridge).
//! Module-split of the former monolithic backend.rs client section.

mod bridge;
mod browser_legs;
mod entity_refs;
mod index;
mod pattern;
mod shared_trait_logic;
mod trait_component;
mod trait_logic;
