local source = debug.getinfo(1, "S").source:gsub("^@", "")
local root = vim.fs.dirname(vim.fs.dirname(vim.fs.normalize(vim.fn.fnamemodify(source, ":p"))))
vim.opt.runtimepath:append(root)
local circuit = require("almadar.circuit")

local function bind(label, type, src)
    return { path = label, kind = "binding", label = label, type = type, source = src, names = {}, children = {} }
end
local function lit(label, type) return { path = label, kind = "literal", label = label, type = type, names = {}, children = {} } end
local function call(label, form, children, type, infix, names)
    return { path = label, kind = "call", label = label, form = form, type = type, infix = infix or false, names = names or {}, children = children }
end
local function infix(label, left, right, type) return call(label, "block", { left, right }, type, true) end
local function container(kind, label, children, names)
    return { path = label, kind = kind, label = label, names = names or {}, children = children }
end
local function lambda(params, body) return container("lambda", "fn", { body }, params) end
local function transition(guard, effects)
    local names, children = {}, {}
    if guard then names[#names + 1] = "guard"; children[#children + 1] = guard end
    names[#names + 1] = "effects"
    children[#children + 1] = container("array", "effects", effects)
    return { from = "idle", to = "loaded", event = "SOURCES", root = container("object", "{…}", children, names) }
end

local function has(haystack, needle) return haystack:find(needle, 1, true) ~= nil end
local function cell(line, byte) return vim.fn.strdisplaywidth(line:sub(1, byte - 1)) end
local function count(line, needle)
    local total, from = 0, 1
    while true do
        local at = line:find(needle, from, true)
        if not at then return total end
        total, from = total + 1, at + 1
    end
end

-- the bands of a render: groups of lines separated by blank lines, after the header
local function bands(lines)
    local out, current = {}, nil
    for index = 2, #lines do
        if lines[index] == "" then
            current = nil
        else
            if not current then current = {}; out[#out + 1] = current end
            current[#current + 1] = lines[index]
        end
    end
    return out
end

-- one band: odd height, the prefix on the middle row, every box top on the row above it
-- with matching walls and bottoms, loop frames strictly outside the boxes
local function check_band(group, prefix)
    assert(#group % 2 == 1, "a band has an odd number of rows\n" .. table.concat(group, "\n"))
    local mid = (#group + 1) / 2
    assert(group[mid]:sub(1, #prefix) == prefix, "prefix " .. prefix .. " on the middle row\n" .. table.concat(group, "\n"))
    for row, line in ipairs(group) do
        local from = 1
        while true do
            local at = line:find("┌─", from, true)
            if not at then break end
            assert(row == mid - 1, "a box top off the shared row " .. row .. "\n" .. table.concat(group, "\n"))
            local column = cell(line, at)
            local function char_at(text)
                local used = 0
                for index = 0, vim.fn.strchars(text) - 1 do
                    local char = vim.fn.strcharpart(text, index, 1)
                    if used == column then return char end
                    used = used + vim.fn.strdisplaywidth(char)
                end
            end
            assert(char_at(group[mid]) == "│", "box wall under the top at cell " .. column .. "\n" .. table.concat(group, "\n"))
            assert(char_at(group[mid + 1]) == "└", "box bottom under the top at cell " .. column .. "\n" .. table.concat(group, "\n"))
            from = at + 1
        end
        local frame = line:find("┌ for each", 1, true)
        if frame then assert(row < mid - 1, "a loop frame wraps the boxes\n" .. table.concat(group, "\n")) end
    end
    local tops, bottoms = {}, {}
    for row, line in ipairs(group) do
        if row < mid - 1 then
            local at = line:find("┐", 1, true)
            while at do tops[#tops + 1] = cell(line, at); at = line:find("┐", at + 1, true) end
        elseif row > mid + 1 then
            local at = line:find("┘", 1, true)
            while at do bottoms[#bottoms + 1] = cell(line, at); at = line:find("┘", at + 1, true) end
        end
    end
    table.sort(tops); table.sort(bottoms)
    assert(vim.inspect(tops) == vim.inspect(bottoms), "frame corners line up " .. vim.inspect(tops) .. vim.inspect(bottoms) .. "\n" .. table.concat(group, "\n"))
    return group[mid]
end

local function render(tree)
    local lines, spans = circuit.layout(tree, 10000)
    return table.concat(lines, "\n"), lines, spans
end

local function find_band(lines, prefix)
    for _, group in ipairs(bands(lines)) do
        for _, line in ipairs(group) do
            if line:sub(1, #prefix + 1) == prefix .. " " then return group end
        end
    end
    error("no band " .. prefix)
end

-- A: a simple effect
local a = transition(nil, {
    call("set", "actuator", { bind("@entity.tag"), call("default", "block", { bind("@payload.tag", "string"), lit('""', "string") }, "string") }),
})
local text_a, lines_a, spans_a = render(a)
print(text_a .. "\n")
local mid_a = check_band(find_band(lines_a, "1 ▶"), "1 ▶")
assert(has(text_a, "idle ──SOURCES──▶ loaded"))
assert(has(mid_a, 'default(@payload.tag, "")') and has(mid_a, "─‹string›─▶") and has(mid_a, "⟹ set @entity.tag"), mid_a)
assert(#find_band(lines_a, "1 ▶") == 3, "a band without a loop is three rows")
assert(mid_a:find("⟹", 1, true) > select(2, mid_a:find(".*─▶")) - 6, "the actuator closes the band")
assert(not has(text_a, "●") and #spans_a > 0)

-- B: the guard of the owner example, a loop frame with and-joined operands
local function p(label, type) return bind(label, type, "fn1.params[0]") end
local some = call("array/some", "conveyor", {
    bind("@entity.pending", "[Pending]"),
    lambda({ "p" }, call("and", "series", {
        infix("=", p("@p.requestId", "number"), bind("@payload.requestId", "number"), "boolean"),
        infix("=", p("@p.path", "string"), lit('"/api/inspector/trace"', "string"), "boolean"),
        infix("=", call("str/upper", "block", { p("@p.method", "string") }, "string"), lit('"GET"', "string"), "boolean"),
    }, "boolean")),
}, "boolean")
some.children[2].path = "fn1"
local b = transition(some, { call("emit", "actuator", { lit('"DONE"') }) })
local text_b, lines_b = render(b)
print(text_b .. "\n")
local group_b = find_band(lines_b, "guard ▶")
local mid_b = check_band(group_b, "guard ▶")
assert(#group_b == 5, "a loop makes the band five rows")
for _, needle in ipairs({
    "│ @entity.pending │", "─‹[Pending]›─▶", "│ ⇶ array/some p │", "p.requestId = @payload.requestId", "─⊓─", 'p.path = "/api/inspector/trace"',
    'str/upper(p.method) = "GET"', "─‹boolean›─▶ ✓ fires / ✗ blocked",
}) do assert(has(mid_b, needle), "guard missing " .. needle .. "\n" .. mid_b) end
assert(has(group_b[1], "┌ for each p") and has(group_b[5], "└"))
assert(not has(text_b, "@p."), "a sourced local has no @")
assert(not has(text_b, "●"))
assert(has(find_band(lines_b, "1 ▶")[2], '⟹ emit "DONE"'))
assert(count(mid_b, "─⊓─") == 2)
-- the frame wraps exactly the inner boxes
local frame_left = group_b[1]:find("┌ for each", 1, true)
local frame_right = group_b[1]:find("┐", frame_left, true)
local last_box_end = mid_b:find("│─‹boolean›", 1, true)
assert(cell(group_b[1], frame_right) + 1 == cell(mid_b, last_box_end) + 1 and frame_left < last_box_end, "frame right edge")

-- C: sequential lets, each its own box, later boxes just write the name
local function field(name) return bind(name, "number", "fn2.params[0]") end
local c_tree = call("let", "scope", {
    infix("-", field("@it.q2"), field("@it.p2"), "number"),
    infix("*", bind("@d2", "number", "d2src"), lit("2", "number"), "number"),
    call("math/max", "block", { bind("@d2", "number", "d2src"), bind("@ls2", "number", "ls2src") }, "number"),
}, nil, false, { "d2", "ls2" })
c_tree.children[1].path, c_tree.children[2].path = "d2src", "ls2src"
local conv = call("array/map", "conveyor", { bind("@payload.items", "[Item]"), lambda({ "it" }, c_tree) }, "[number]")
local c = transition(nil, { call("set", "actuator", { bind("@entity.results"), conv }) })
local text_c, lines_c = render(c)
print(text_c .. "\n")
local group_c = find_band(lines_c, "1 ▶")
local mid_c = check_band(group_c, "1 ▶")
local order = {}
for _, needle in ipairs({ "d2 = it.q2 - it.p2", "ls2 = d2 * 2", "math/max(d2, ls2)", "─‹[number]›─▶", "⟹ set @entity.results" }) do
    local at = mid_c:find(needle, 1, true)
    assert(at, "let chain missing " .. needle .. "\n" .. mid_c)
    assert(not order[#order] or at > order[#order], "steps in order: " .. needle)
    order[#order + 1] = at
end
assert(not has(text_c, "@it") and not has(text_c, "@d2") and not has(text_c, "@ls2"), "locals have no @")

-- D: and / or chains stay on one line
local d_tree = call("or", "parallel", {
    call("and", "series", { bind("@a", "boolean"), bind("@b", "boolean") }, "boolean"),
    call("not", "invert", { infix("=", bind("@c", "number"), lit("1", "number"), "boolean") }, "boolean"),
}, "boolean")
local d = transition(d_tree, { call("noop", "unknown", {}) })
local text_d, lines_d = render(d)
print(text_d .. "\n")
local group_d = find_band(lines_d, "guard ▶")
local mid_d = check_band(group_d, "guard ▶")
assert(#group_d == 3, "and/or never stack")
assert(has(mid_d, "│ @a │─⊓─│ @b │─⊔─│ not (@c = 1) │─‹boolean›─▶ ✓ fires / ✗ blocked"), mid_d)
assert(has(find_band(lines_d, "1 ▶")[2], "noop()"))

-- E: a long box is split along one argument only
local long = call("array/range", "block", {
    lit("0", "number"),
    call("math/floor", "block", { infix("/", bind("@ls2", "number"), bind("@payload.someVeryLongName", "number"), "number") }, "number"),
    call("math/ceil", "block", { bind("@payload.x", "number") }, "number"),
}, "[number]")
local e = transition(nil, { call("set", "actuator", { bind("@entity.results"), long }) })
local text_e, lines_e = render(e)
print(text_e .. "\n")
local group_e = find_band(lines_e, "1 ▶")
local mid_e = check_band(group_e, "1 ▶")
assert(count(mid_e, "●") == 1, "exactly one placeholder\n" .. mid_e)
assert(has(mid_e, "math/floor(@ls2 / @payload.someVeryLongName)") and has(mid_e, "array/range(0, ●, math/ceil(@payload.x))"), mid_e)
assert(mid_e:find("math/floor", 1, true) < mid_e:find("array/range", 1, true), "the split argument comes first")
for _, text in ipairs({ text_a, text_b, text_c, text_d }) do assert(not has(text, "●"), "● only in split boxes") end

-- F: a reduce with an initial value
local step = infix("+", bind("@z", "number", "fn3.params[1]"), bind("@p.v", "number", "fn3.params[0]"), "number")
local reduce = call("array/reduce", "conveyor", { bind("@entity.xs", "[Item]"), lit("1", "number"), lambda({ "p", "z" }, step) }, "number")
local f = transition(nil, { call("set", "actuator", { bind("@entity.total"), reduce }) })
local text_f, lines_f = render(f)
print(text_f .. "\n")
local mid_f = check_band(find_band(lines_f, "1 ▶"), "1 ▶")
for _, needle in ipairs({ "⇶ array/reduce p z from 1", "┐" }) do assert(has(mid_f, needle) or has(text_f, needle), needle) end
assert(has(mid_f, "z + p.v") and has(text_f, "┌ for each p z"), mid_f)

-- G: nested loops
local inner = call("array/map", "conveyor", { bind("@row", nil, "fn4.params[0]"), lambda({ "q" }, bind("@q.z", "number", "fn5.params[0]")) }, "[number]")
local outer = call("array/map", "conveyor", { bind("@entity.grid", "[[number]]"), lambda({ "row" }, inner) }, "[[number]]")
local g = transition(nil, { call("set", "actuator", { bind("@entity.cells"), outer }) })
local text_g, lines_g = render(g)
print(text_g .. "\n")
local group_g = find_band(lines_g, "1 ▶")
local mid_g = check_band(group_g, "1 ▶")
assert(#group_g == 7, "two nested loops make the band seven rows\n" .. text_g)
assert(has(text_g, "┌ for each row") and has(text_g, "┌ for each q"))
assert(has(mid_g, "⇶ array/map row") and has(mid_g, "⇶ array/map q") and has(mid_g, "─‹[[number]]›─▶"), mid_g)
assert(has(mid_g, "│ row │") or has(mid_g, "│ row"), mid_g)

-- ladders keep sub-bands
local rungs = call("do", "ladder", { call("set", "actuator", { bind("@a"), lit("1") }), call("emit", "actuator", { lit('"X"') }) })
local text_h, lines_h = render(transition(nil, { rungs }))
print(text_h .. "\n")
for _, needle in ipairs({ "1 ▶", "≡ do", "1.1 ▶", "1.2 ▶", "⟹ set @a 1", '⟹ emit "X"' }) do assert(has(text_h, needle), needle) end
check_band(find_band(lines_h, "1.1 ▶"), "1.1 ▶")

-- no wrapping: a wide band is one line per row, and the window width changes nothing
local wide = bind("@seed", "number")
local chain_node = wide
for index = 1, 12 do chain_node = call("op" .. index, "block", { chain_node, lit(tostring(index)) }, "number") end
local text_i, lines_i = render(transition(nil, { call("set", "actuator", { bind("@entity.t"), chain_node }) }))
check_band(find_band(lines_i, "1 ▶"), "1 ▶")
assert(vim.fn.strdisplaywidth(find_band(lines_i, "1 ▶")[2]) > 200, "the band grows wider instead of wrapping")

-- FLOW WRAP: the same boxes in the same order at any window width, nothing wider than the window
local function char_at(text, column)
    local used = 0
    for index = 0, vim.fn.strchars(text) - 1 do
        local char = vim.fn.strcharpart(text, index, 1)
        if used == column then return char end
        used = used + vim.fn.strdisplaywidth(char)
    end
end
local function occurrences(line, needle)
    local out, from = {}, 1
    while true do
        local at = line:find(needle, from, true)
        if not at then return out end
        out[#out + 1] = at
        from = at + 1
    end
end
local function widest(lines)
    local size = 0
    for _, line in ipairs(lines) do size = math.max(size, vim.fn.strdisplaywidth(line)) end
    return size
end
local function order_of(lines, tokens)
    local found = {}
    for _, token in ipairs(tokens) do
        for row, line in ipairs(lines) do
            local at = line:find(token, 1, true)
            if at then found[#found + 1] = { row = row, col = cell(line, at), token = token }; break end
        end
        assert(#found > 0 and found[#found].token == token, "token missing: " .. token .. "\n" .. table.concat(lines, "\n"))
    end
    table.sort(found, function(x, y) if x.row ~= y.row then return x.row < y.row end return x.col < y.col end)
    local names = {}
    for _, item in ipairs(found) do names[#names + 1] = item.token end
    return names
end
local function frames_align(lines)
    for row, line in ipairs(lines) do
        for _, at in ipairs(occurrences(line, "┌ for each")) do
            local left = cell(line, at)
            local right = cell(line, line:find("┐", at, true))
            local closed
            for below = row + 1, #lines do
                local l, r = char_at(lines[below], left), char_at(lines[below], right)
                if l == "└" then
                    assert(r == "┘", "frame bottom corners align at row " .. below .. "\n" .. table.concat(lines, "\n"))
                    closed = true
                    break
                end
                assert(l == "│" and (r == "│"), "frame walls at row " .. below .. "\n" .. table.concat(lines, "\n"))
            end
            assert(closed, "frame never closes\n" .. table.concat(lines, "\n"))
        end
    end
end
local function strip_art(lines)
    return (table.concat(lines, ""):gsub("[│┌┐└┘─▶↳↵%s]", ""))
end

local fixtures = {
    { a, { "default(", "set @entity.tag" } },
    { b, { "@entity.pending", "array/some", "p.requestId", "p.path", "str/upper", "fires", "emit" } },
    { c, { "@payload.items", "array/map", "it.q2", "ls2", "math/max", "set @entity.results" } },
    { d, { "@a", "@b", "not", "noop" } },
    { e, { "math/floor", "array/range", "set @entity.results" } },
    { f, { "@entity.xs", "array/reduce", "z + p.v", "set @entity.total" } },
    { g, { "@entity.grid", "array/map row", "array/map q", "q.z", "set @entity.cells" } },
    { transition(nil, { chain_node }), { "op1(", "op6(", "op12(" } },
}
for index, fixture in ipairs(fixtures) do
    local _, plain = render(fixture[1])
    local expected = order_of(plain, fixture[2])
    assert(vim.inspect(expected) == vim.inspect(fixture[2]), "unwrapped order " .. index)
    for _, size in ipairs({ 60, 100, 200 }) do
        local lines = circuit.layout(fixture[1], size)
        local label = "fixture " .. index .. " at " .. size .. "\n" .. table.concat(lines, "\n")
        assert(widest(lines) <= size, "a line is wider than " .. size .. ": " .. widest(lines) .. "\n" .. label)
        assert(vim.inspect(order_of(lines, fixture[2])) == vim.inspect(fixture[2]), "box order changed\n" .. label)
        frames_align(lines)
        local ends, starts = 0, 0
        for _, line in ipairs(lines) do
            ends = ends + #occurrences(line, "↵")
            starts = starts + #occurrences(line, "↳")
        end
        assert(ends == starts, "every ↵ has a ↳\n" .. label)
        assert(not table.concat(lines, "\n"):find("%.%.%.") , "nothing is elided")
    end
end

-- in a flat band every ↵ is followed by its ↳ before the next ↵
local flat = circuit.layout(transition(nil, { chain_node }), 60)
local marks = {}
for row, line in ipairs(flat) do
    for _ = 1, #occurrences(line, "↵") do marks[#marks + 1] = { "end", row } end
    for _ = 1, #occurrences(line, "↳") do marks[#marks + 1] = { "start", row } end
end
table.sort(marks, function(x, y) return x[2] < y[2] or (x[2] == y[2] and x[1] == "start" and y[1] == "end") end)
assert(#marks > 4, "a narrow window wraps the chain\n" .. table.concat(flat, "\n"))
for index, mark in ipairs(marks) do
    assert(mark[1] == (index % 2 == 1 and "end" or "start"), "↵ then ↳ in turn\n" .. table.concat(flat, "\n"))
end
print(table.concat(circuit.layout(b, 60), "\n") .. "\n")
print(table.concat(flat, "\n") .. "\n")

-- a box wider than the window wraps its text and loses none
local args = {}
for index = 1, 6 do args[index] = bind("@payload.someLongArgumentName" .. index) end
local long_call = call("pipeline/with/a/long/name", "block", args)
local expression = "pipeline/with/a/long/name(" .. table.concat(vim.tbl_map(function(node) return node.label end, args), ", ") .. ")"
for _, size in ipairs({ 40, 60, 100 }) do
    local lines = circuit.layout(transition(nil, { long_call }), size)
    assert(widest(lines) <= size, "wide box wider than " .. size .. "\n" .. table.concat(lines, "\n"))
    local group = find_band(lines, "1 ▶")
    local text = "1" .. expression:gsub("%s", "")
    assert(strip_art(group) == text, "a wrapped box keeps its text\n" .. strip_art(group) .. "\n" .. text)
    if size < 100 then assert(#group > 3, "the box grew taller at " .. size) end
end

-- a long type label moves to the next row and wraps rather than being cut
local long_type = "[{ " .. string.rep("field: number, ", 12) .. "last: string }]"
local typed = transition(nil, { call("set", "actuator", { bind("@entity.t"), call("first", "block", { call("rows", "block", {}) }, long_type) }) })
for _, size in ipairs({ 60, 100 }) do
    local lines = circuit.layout(typed, size)
    assert(widest(lines) <= size, "typed arrow wider than " .. size .. "\n" .. table.concat(lines, "\n"))
    assert(has(strip_art(lines), (long_type:gsub("%s", ""))), "the type label is whole\n" .. table.concat(lines, "\n"))
    assert(has(table.concat(lines, "\n"), "↳"), "the label moved to a continuation row")
end

-- the last circuit lives on the buffer and a resize repaints it at the new width
circuit.show(b)
local circuit_buf = vim.fn.bufnr("almadar://circuit")
local circuit_window = vim.fn.bufwinid(circuit_buf)
assert(vim.b[circuit_buf].almadar_circuit.root, "the circuit is kept on the buffer")
local before = vim.api.nvim_buf_get_lines(circuit_buf, 0, -1, false)
vim.api.nvim_win_set_width(circuit_window, 70)
vim.api.nvim_exec_autocmds("WinResized", {})
local resized = vim.api.nvim_buf_get_lines(circuit_buf, 0, -1, false)
assert(widest(resized) <= vim.api.nvim_win_get_width(circuit_window), "repaint honours the new width")
assert(vim.inspect(before) ~= vim.inspect(resized), "the repaint changed the layout")
assert(vim.inspect(resized) == vim.inspect((circuit.layout(b, vim.api.nvim_win_get_width(circuit_window)))))
assert(not vim.wo[circuit_window].wrap)

-- painting writes lines and highlight extmarks
local buf = vim.api.nvim_create_buf(false, true)
circuit.paint(buf, b, 10000)
assert(#vim.api.nvim_buf_get_lines(buf, 0, -1, false) == #lines_b)
local marks = vim.api.nvim_buf_get_extmarks(buf, circuit.namespace, 0, -1, { details = true })
local seen = {}
for _, mark in ipairs(marks) do seen[mark[4].hl_group] = true end
for _, group_name in ipairs({
    "AlmadarCircuitActuator", "AlmadarCircuitBinding", "AlmadarCircuitType", "AlmadarCircuitString", "AlmadarCircuitKeyword",
    "AlmadarCircuitWire", "AlmadarCircuitOperator",
}) do assert(seen[group_name], "no extmark for " .. group_name) end

-- the split never wraps and scrolls sideways
circuit.show(a)
local window = vim.fn.bufwinid(vim.fn.bufnr("almadar://circuit"))
assert(window ~= -1 and not vim.wo[window].wrap, "the circuit window must not wrap")
assert(vim.wo[window].sidescrolloff > 0 and vim.o.sidescroll > 0)
assert(circuit.visible())
print("circuit: boxes on one band, frames, lets, and/or, split boxes, reduce, nested loops, flow wrap at 60/100/200, wrapped boxes and labels, resize repaint and extmarks passed")
