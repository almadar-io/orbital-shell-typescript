# Almadar for Neovim

Language support for `.lolo` (the authoring surface) and `.orb` (the IR it
lowers to) — the Neovim sibling of `editors/vscode` and `editors/zed`.

- **Tree-sitter highlighting** for both languages, from the same
  `tree-sitter-lolo` grammar the Zed extension uses.
- **Diagnostics** via `orb-lsp`, the same stdio server VSCode and Zed drive.
- **Regex-syntax fallback** when a tree-sitter parser is unavailable.
- **`:Orb*` commands** over the `orb` CLI — validate into the quickfix list,
  emit, verify, serve, format.
- Filetype detection, comment strings, folds, indentation.

Requires Neovim **0.10+** (0.11+ recommended) and, for the parser build, a C
compiler on `$PATH`.

## Install

The plugin lives in the shell repository at `tooling/syntax/editors/nvim`, and resolves the
tree-sitter grammar from its sibling `editors/zed/tree-sitter-lolo`. Point your
plugin manager at that subdirectory.

**lazy.nvim**

```lua
{
  "almadar-io/orbital-shell-typescript",
  -- The repo root is not the plugin root: only tooling/syntax/editors/nvim goes on the rtp.
  config = function(plugin)
    vim.opt.runtimepath:append(plugin.dir .. "/tooling/syntax/editors/nvim")
    require("almadar").setup({})
  end,
  ft = { "lolo", "orb" },
  init = function()
    vim.filetype.add({ extension = { lolo = "lolo", orb = "orb" } })
  end,
}
```

**Local checkout** (developing against the monorepo):

```lua
{
  dir = "~/kflow.ai.builder/orbital-rust/crates/orbital-shell-typescript/tooling/syntax/editors/nvim",
  name = "almadar",
  opts = {},
}
```

No `setup()` call is required — filetypes, highlighting, and the `:Orb*`
commands work off the defaults. Call it only to change them.

## Configuration

```lua
require("almadar").setup({
  cmd = nil,                       -- path to `orb`; nil = resolve from $PATH
  treesitter = {
    enabled = true,
    auto_install = true,           -- compile the bundled parser on demand
    grammar_dir = nil,             -- override tree-sitter-lolo's location
    parser_dir = nil,              -- default: stdpath("data")/almadar/parser
    compiler = { "cc", "gcc", "clang", "zig cc" },
  },
  lsp = {
    enabled = true,
    cmd = nil,                     -- default: node <pkg>/lsp/bin/orb-lsp.js --stdio
    root_markers = { ".orbital", "orb.json", "package.json", ".git" },
  },
})
```

## Commands

| Command | What it does |
| --- | --- |
| `:OrbValidate` | `orb validate --json` on the current file → quickfix list |
| `:OrbEmit [orb\|ts\|python]` | `orb emit` into a scratch split (default `orb`) |
| `:OrbVerify [args]` | `orb verify` in a terminal split |
| `:OrbServe [args]` | `orb serve` in a terminal split |
| `:OrbSignatures` | the embedded lolo type-signature catalog |
| `:OrbFormat` | `orb format` the current file in place |
| `:OrbPreview` | open the orb-lsp live preview in a browser |
| `:OrbInspect` | inspect the current behavior in a native Neovim diagram split |
| `:OrbCircuit` | draw the transition under the cursor as a box-drawing circuit in a split (needs `:OrbInspect`) |
| `:OrbInspectClose` | close the native inspector and its process |
| `:OrbBuildParser` | force a rebuild of the tree-sitter-lolo parser |

`:checkhealth almadar` reports on the CLI, both parsers, the compiled queries,
and the language server.

## Native behavior inspector

The inspector runs the io `orb-inspector.lolo` program through `orb run`.
Generic layout and line transport live in `@almadar/std`; Orb program
inspection and composition live in `@almadar-io/behaviors`. Neovim measures
terminal text and renders the native layout, without a browser or Node host.

Configure the native entry point explicitly:

```lua
require("almadar").setup({
  inspector = {
    program = "~/kflow.ai.builder/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-inspector.lolo",
    width = 72,
  },
})
```

An `inspector.command` array can select a development binary and replaces
the default `orb run <program>` command. The workspace `nvim/init.lua`
already configures the entry point and maps `<leader>oi` to `:OrbInspect`.

| Option | Meaning |
| --- | --- |
| `inspector.cwd` | working directory of the inspector process; set it to the workspace root so std atoms such as `circuit` resolve `node_modules/@almadar/std` and fs grants (default: the source file's directory) |

Open a named `.lolo` buffer and run `:OrbInspect`. Unsaved buffer text is
sent to the native reader with its original path and document version.
Choose the trait to inspect. Inside the diagram, `Enter` jumps to a native
source location, `K` opens the complete element and machine details, `t`
chooses another trait, `r` refreshes, and `q` closes the inspector. Moving
the source cursor highlights its corresponding state or transition. Large
diagrams scroll; labels and source content are retained in full.

Source locations come from the native lowerer and composition provenance.
Approximate locations are identified explicitly; missing locations are
reported instead of guessed. The editor refuses stale source navigation
while a changed document is awaiting a new diagram.

Attach to an explicitly identified runtime using the native HTTP contract:

```vim
:OrbInspectAttach http://127.0.0.1:3030 /api/inspector/trace <runtime-instance>
```

The origin, absolute endpoint path, and expected instance are separate arguments.
The view remains unobserved until an authoritative matching execution outcome
arrives. Native projections supply observed states and completed transitions;
failed guards do not highlight a completed transition. The status identifies
whether observations bind to the effective definition or its generic source
definition. Source-definition observations do not claim that the displayed
generic config equals the running realization's overrides.

`:OrbInspectTrace` opens all received native trace and diagram messages, frame
identities, guards, effects, and binding findings without truncation.
`:OrbInspectDetach` disconnects observation and clears execution overlays.
Refreshing the source or changing the selected trait clears old overlays until
a matching native projection arrives. Ambiguous source bindings are reported
visibly and are not highlighted.

## How highlighting works

**`.lolo`** uses `tree-sitter-lolo`. Its generated `parser.c` is committed, so
the plugin compiles it on first use with the system C compiler (~1s, once) into
`stdpath("data")/almadar/parser/lolo.so` and loads it with
`vim.treesitter.language.add`. There is no dependency on `nvim-treesitter`; if
a `lolo` parser is already on the runtimepath it is used as-is.

**`.orb`** is JSON. Mapping the filetype onto the `json` language would force
every `.orb`-specific rule into `queries/json/`, where it would also colour
ordinary JSON files. Instead the stock JSON parser is loaded a *second* time
under the language name `orb`:

```lua
vim.treesitter.language.add("orb", { path = <json parser>, symbol_name = "json" })
```

That gives `.orb` its own query namespace, so `queries/orb/highlights.scm` can
layer S-expression colouring (operators, effects, bindings, event keys, UI
slots) on top of JSON without touching `json` itself.

## Generated files — do not edit

| File | Generated from |
| --- | --- |
| `queries/lolo/highlights.scm` | `src/editor/nvim-grammar.ts` |
| `queries/orb/highlights.scm` | `src/editor/nvim-grammar.ts` |
| `syntax/lolo.vim` | `src/editor/nvim-grammar.ts` |
| `syntax/orb.vim` | `src/editor/nvim-grammar.ts` |

Every keyword, operator, effect, pattern, and behavior name in them comes from
`@almadar/syntax`'s `tokens.json` — the same registry that feeds the VSCode
TextMate grammar and the Zed query — so they cannot drift from the language.
Regenerate with:

```sh
pnpm run generate-grammar   # from orbital-rust/crates/orbital-shell-typescript/tooling/syntax
```

`queries/lolo/folds.scm` and `queries/lolo/indents.scm` are hand-authored:
block structure is grammar shape, not registry content.

## Known limitation: unparsed `.lolo` constructs

`tree-sitter-lolo` does not yet cover every construct the real
`orbital-lolo` parser accepts. Across the 870-file std + behaviors corpus, 833
files (95.7%) parse cleanly; 37 contain a region tree-sitter cannot parse
(0.92% of all lines, though 6 files fail wholesale). The unsupported forms are
tracked in `docs/Almadar_Compiler_Gaps.md` (`C-TSLOLO-*`).

In practice this is barely visible: tree-sitter's error recovery still colours
92–95% of lines in the files it cannot parse at all — the same share as a
cleanly-parsed file — because the unparsed region keeps its inner nodes. The
regex syntax files are therefore a *fallback for a missing parser* (no C
compiler, no `json` parser), not a layer on top of tree-sitter.
