local source = debug.getinfo(1, "S").source:gsub("^@", "")
local root = vim.fs.dirname(vim.fs.dirname(vim.fs.normalize(vim.fn.fnamemodify(source, ":p"))))
vim.opt.runtimepath:append(root)
local circuit = require("almadar.circuit")

local function bind(label, type) return { path = label, kind = "binding", label = label, type = type, names = {}, children = {} } end
local function lit(label, type) return { path = label, kind = "literal", label = label, type = type, names = {}, children = {} } end
local function call(label, form, children, type, names)
    return { path = label, kind = "call", label = label, form = form, type = type, names = names or {}, children = children }
end
local function lambda(params, body)
    return { path = "fn", kind = "lambda", label = "fn", names = params, children = { body } }
end
local function transition(guard, effects)
    local names, children = {}, {}
    if guard then names[#names + 1] = "guard"; children[#children + 1] = guard end
    names[#names + 1] = "effects"
    children[#children + 1] = { path = "effects", kind = "array", label = "effects", names = {}, children = effects }
    return { from = "idle", to = "loaded", event = "SOURCES", root = { path = "", kind = "object", label = "{…}", names = names, children = children } }
end

local filter = call("array/filter", "conveyor", {
    bind("@entity.sourceMap", "[InspectorSource]"),
    lambda({ "s" }, bind("@s.exact", "boolean")),
}, "[InspectorSource]")
local group = call("array/groupBy", "block", { filter, lit('"pointer"', "string") }, "Map string [InspectorSource]")
local set = call("set", "actuator", { bind("@entity.focusSourceGroups"), group })
local a = transition(nil, { set })

local some = call("array/some", "conveyor", {
    bind("@entity.pending", "[Pending]"),
    lambda({ "p" }, call("and", "series", {
        call("=", "block", { bind("@p.requestId", "string"), bind("@payload.requestId", "string") }, "boolean"),
        call("=", "block", { bind("@p.path", "string"), bind("@config.path", "string") }, "boolean"),
        call("=", "block", { call("str/upper", "block", { bind("@p.method", "string") }, "string"), lit('"GET"', "string") }, "boolean"),
    }, "boolean")),
}, "boolean")
local b = transition(some, { call("emit", "actuator", { lit('"DONE"') }) })

local function text(tree, width)
    local lines, spans = circuit.layout(tree, width)
    return table.concat(lines, "\n"), lines, spans
end

local rendered_a, lines_a, spans_a = text(a, 220)
local rendered_b = text(b, 220)
print(rendered_a .. "\n")
print(rendered_b .. "\n")

local function has(haystack, needle) return haystack:find(needle, 1, true) ~= nil end
for _, needle in ipairs({
    "idle ──SOURCES──▶ loaded", "effects", "1 ▶", "⇶ array/filter", "▣ array/groupBy", "⟹ set @entity.focusSourceGroups",
    "‹[InspectorSource]›", "‹Map string [InspectorSource]›", "‹boolean›", "┆ s → @s.exact", '"pointer"', "├─▶", "┐", "┘",
}) do assert(has(rendered_a, needle), "A missing " .. needle .. "\n" .. rendered_a) end
for _, needle in ipairs({
    "guard", "⇶ array/some", "⊓ and · all must pass", "▣ =", "▣ str/upper", "┆ p →", "✓ fires / ✗ blocked", "⟹ emit",
    "@payload.requestId", '"GET"',
}) do assert(has(rendered_b, needle), "B missing " .. needle .. "\n" .. rendered_b) end

-- the actuator is the rightmost operator on its rung
for _, line in ipairs(lines_a) do
    if has(line, "⟹") then
        assert(not has(line:sub(line:find("⟹", 1, true) + 3), "▣"), "actuator must be rightmost")
    end
end
assert(#spans_a > 0)

-- branch tags, scope names, ladder rungs, template keys, invert
local branch = call("if", "branch", { bind("@a"), lit("1"), lit("2") }, "number")
local scope = call("let", "scope", { lit("5"), call("+", "block", { bind("n"), lit("1") }) }, nil, { "n" })
local not_ = call("not", "invert", { bind("@flag") })
local object = call("object", "template", { bind("@x"), bind("@y") }, nil, { "left", "right" })
local rungs = call("do", "ladder", { call("set", "actuator", { bind("@a"), lit("1") }), call("emit", "actuator", { lit('"X"') }) })
local odd = text(transition(branch, { scope, call("noop", "unknown", {}), not_, object, rungs }), 120)
for _, needle in ipairs({ "─?─", "─✓─", "─✗─", "n ═", "body", "?▣ noop", "○ not", "left", "right", "{…}", "≡ do", "1 ▶", "2 ▶", "5 ▶" }) do
    assert(has(odd, needle), "forms missing " .. needle .. "\n" .. odd)
end
print(odd .. "\n")

-- narrow window wraps a subtree into a numbered block, never truncating text
local narrow = text(a, 90)
assert(has(narrow, "↳ (1)"), narrow)
for _, needle in ipairs({ "array/filter", "array/groupBy", "@entity.sourceMap", "‹Map string [InspectorSource]›", "@entity.focusSourceGroups" }) do
    assert(has(narrow, needle), "wrapped render lost " .. needle .. "\n" .. narrow)
end
print(narrow .. "\n")

-- painting writes lines and highlight extmarks
local buf = vim.api.nvim_create_buf(false, true)
circuit.paint(buf, a, 220)
assert(#vim.api.nvim_buf_get_lines(buf, 0, -1, false) == #lines_a)
local marks = vim.api.nvim_buf_get_extmarks(buf, circuit.namespace, 0, -1, { details = true })
local seen = {}
for _, mark in ipairs(marks) do seen[mark[4].hl_group] = true end
for _, group_name in ipairs({ "AlmadarCircuitActuator", "AlmadarCircuitBinding", "AlmadarCircuitType", "AlmadarCircuitString" }) do
    assert(seen[group_name], "no extmark for " .. group_name)
end
print("circuit: forms, types, actuator rightmost, wrapping and extmarks passed")
