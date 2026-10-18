use crate::backend::*;

impl TypeScriptBackend {

    // ========================================================================
    // Phase 2: Structural Location — Logic Hook + Presentation Component
    // ========================================================================




    /// Parse an `@trait.X` binding from a bare string. Returns the trait
    /// name when the string matches exactly `@trait.<PascalName>`, else
    /// `None`. Multi-segment forms (`@trait.X.anything`) intentionally
    /// DO NOT match — the compiler's binding validator rejects them up
    /// front, so any leak-through here is treated as invalid and
    /// ignored for import collection / JSX emission.
    pub(crate) fn parse_trait_binding(&self, s: &str) -> Option<String> {
        let rest = orbital_core_base::ir::parse_trait_embed_token(s)?;
        // V4 leverage-ids: an embed token names a sibling trait by its DISPLAY
        // name; if that sibling was renamed, `current_trait_embed_names` maps
        // the (stale) token to the current declaration name via the stable id
        // (see `build_trait_embed_names`). Missing map / missing key → the raw
        // token, byte-identical to the pre-flip behavior.
        if let Some(current) = self
            .current_trait_embed_names
            .borrow()
            .as_ref()
            .and_then(|m| m.get(rest))
        {
            return Some(current.clone());
        }
        Some(rest.to_string())
    }

    /// V4 leverage-ids: resolve a trait's `trait_embed_ids` side-map (embed
    /// token NAME → trait id) into a token NAME → CURRENT display name map by
    /// following each id to its declaration via [`OirModule::resolve_trait_ref`]
    /// (id-first, name-fallback). Stored in `current_trait_embed_names` at trait
    /// entry so `parse_trait_binding` emits `<CurrentNameView />` for a renamed
    /// sibling without a name-rewrite pass. `None` when the trait carries no
    /// side-map → readers fall back to the raw token (today's behavior).
    pub(crate) fn build_trait_embed_names(
        trait_def: &OirTrait,
        module: &OirModule,
    ) -> Option<HashMap<String, String>> {
        trait_def.trait_embed_ids.as_ref().map(|embed| {
            embed
                .iter()
                .map(|(token, id)| {
                    let current = module
                        .resolve_trait_ref(Some(id), token)
                        .map(|t| t.name.clone())
                        .unwrap_or_else(|| token.clone());
                    (token.clone(), current)
                })
                .collect()
        })
    }



}
