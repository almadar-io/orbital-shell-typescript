--- AVL circuit painter: draws one transition's guard and effect tree as
--- box-drawing text. The tree arrives finished from the inspector; this file
--- only lays it out and paints it.
local M = {}
M.namespace = vim.api.nvim_create_namespace("almadar.circuit")

local glyphs = {
    block = "▣", series = "⊓", parallel = "⊔", invert = "○", branch = "◇", scope = "⌸",
    conveyor = "⇶", ladder = "≡", actuator = "⟹", unknown = "?▣",
}
local form_notes = { series = " · all must pass", parallel = " · any passes" }
local branch_tags = { "?", "✓", "✗" }
local groups = {
    block = "@function.builtin", series = "@operator", parallel = "@operator", invert = "@operator",
    branch = "@keyword", scope = "@keyword", template = "@function.builtin", conveyor = "@keyword",
    ladder = "@keyword", unknown = "@function.builtin",
}

local function define_highlights()
    local links = {
        Form = "@function.builtin", Operator = "@operator", Keyword = "@keyword",
        Binding = "@variable.builtin", String = "@string", Number = "@number",
        Actuator = "DiagnosticWarn", Rung = "@keyword", Title = "Title",
    }
    for name, target in pairs(links) do
        vim.api.nvim_set_hl(0, "AlmadarCircuit" .. name, { link = target, default = true })
    end
    vim.api.nvim_set_hl(0, "AlmadarCircuitType", { link = "Comment", italic = true, default = true })
    vim.api.nvim_set_hl(0, "AlmadarCircuitWire", { link = "NonText", default = true })
end

local function width(text) return vim.fn.strdisplaywidth(text) end
local function seg(text, hl) return { text, hl } end
local function line_width(line)
    local total = 0
    for _, part in ipairs(line) do total = total + width(part[1]) end
    return total
end
local function spaces(count) return seg(string.rep(" ", count)) end
local function padded(line, target)
    local copy = vim.list_extend({}, line)
    local missing = target - line_width(line)
    if missing > 0 then copy[#copy + 1] = spaces(missing) end
    return copy
end
local function joined(...)
    local out = {}
    for _, part in ipairs({ ... }) do vim.list_extend(out, part) end
    return out
end

local function block_width(lines)
    local widest = 0
    for _, line in ipairs(lines) do widest = math.max(widest, line_width(line)) end
    return widest
end

local function make(lines, out, leaf)
    return { lines = lines, out = out, w = block_width(lines), leaf = leaf or false }
end

local function wire_text(tag, type_text)
    local out = { seg("─", "AlmadarCircuitWire") }
    if tag then
        out[#out + 1] = seg(tag, "AlmadarCircuitRung")
        out[#out + 1] = seg("─", "AlmadarCircuitWire")
    end
    if type_text then
        out[#out + 1] = seg("‹" .. type_text .. "›", "AlmadarCircuitType")
        out[#out + 1] = seg("─", "AlmadarCircuitWire")
    end
    return out
end

local function leaf_block(node)
    local hl = "AlmadarCircuitBinding"
    if node.kind == "literal" then
        hl = tonumber(node.label) and "AlmadarCircuitNumber" or "AlmadarCircuitString"
    end
    return make({ { seg(node.label, hl) } }, 1, true)
end

--- Prefix the output row; other rows are indented to match.
local function with_prefix(block, prefix_segments, other_segments)
    local indent = line_width(prefix_segments)
    local lines = {}
    for index, line in ipairs(block.lines) do
        if index == block.out then
            lines[index] = joined(prefix_segments, line)
        else
            lines[index] = joined(other_segments and padded(other_segments, indent) or { spaces(indent) }, line)
        end
    end
    return make(lines, block.out, block.leaf)
end

--- Append wire text to the output row, keeping the block rows otherwise intact.
local function with_wire(block, tag, type_text, arrow)
    local lines = vim.list_extend({}, block.lines)
    lines[block.out] = joined(block.lines[block.out], { spaces(1) }, wire_text(tag, type_text),
        arrow and { seg("▶ ", "AlmadarCircuitWire") } or {})
    return make(lines, block.out, block.leaf)
end

local compose

local function lambda_block(node, ctx)
    local body = compose(node.children[1], ctx)
    local params = table.concat(node.names or {}, " ")
    local wired = with_wire(body, nil, node.children[1].type)
    local inner = block_width(wired.lines)
    local belt = "AlmadarCircuitWire"
    local lines = {}
    for index, line in ipairs(wired.lines) do
        local head = index == wired.out
            and { seg("┆ ", belt), seg(params, "AlmadarCircuitBinding"), seg(" → ", belt) }
            or { seg("┆", belt) }
        local head_width = width("┆ " .. params .. " → ")
        local padded_head = padded(head, head_width)
        lines[index] = joined(padded_head, padded(line, inner), { seg(" ┆", belt) })
    end
    return make(lines, wired.out)
end

local function operator_segments(node, leaves)
    local form = node.form
    local label = node.label
    if node.kind == "object" or node.kind == "array" then
        local glyph = node.kind == "object" and "{…}" or "[…]"
        return { seg(glyph, "AlmadarCircuitForm") }
    end
    local glyph = glyphs[form] or glyphs.unknown
    if form == "template" then glyph = "{…}" end
    local hl = form == "actuator" and "AlmadarCircuitActuator" or groups[form] or "AlmadarCircuitForm"
    local parts = { seg(glyph .. " ", hl), seg(label .. (form_notes[form] or ""), hl) }
    for _, leaf in ipairs(leaves) do
        parts[#parts + 1] = seg(" ")
        vim.list_extend(parts, leaf_block(leaf).lines[1])
    end
    return parts
end

local function tag_for(node, index)
    local form, names = node.form, node.names or {}
    if form == "branch" then return branch_tags[index] end
    if form == "scope" then
        if index <= #names then return names[index] .. " ═" end
        return "body"
    end
    return names[index]
end

local function is_leaf(child)
    return child.kind == "binding" or child.kind == "literal"
end

local function assemble(node, entries, op)
    local rows, outs = {}, {}
    local reach = 0
    for _, entry in ipairs(entries) do
        local wired_width = line_width(entry.block.lines[entry.block.out]) + 1
            + line_width(wire_text(entry.tag, entry.type))
        reach = math.max(reach, wired_width)
    end
    for index, entry in ipairs(entries) do
        if index > 1 then rows[#rows + 1] = {} end
        for row_index, line in ipairs(entry.block.lines) do
            if row_index == entry.block.out then
                local content = joined(line, { spaces(1) }, wire_text(entry.tag, entry.type))
                local fill = reach - line_width(content)
                if fill > 0 then content[#content + 1] = seg(string.rep("─", fill), "AlmadarCircuitWire") end
                rows[#rows + 1] = content
                outs[#outs + 1] = #rows
            else
                rows[#rows + 1] = padded(line, reach)
            end
        end
    end
    local count = #entries
    local wire = "AlmadarCircuitWire"
    if count == 1 then
        local row = outs[1]
        rows[row] = joined(rows[row], { seg("▶ ", wire) }, op)
        return make(rows, row)
    end
    local op_row = math.floor((outs[1] + outs[count]) / 2)
    local is_out = {}
    for _, row in ipairs(outs) do is_out[row] = true end
    for row = outs[1], outs[count] do
        local char = "│"
        if row == outs[1] then char = "┐"
        elseif row == outs[count] then char = "┘"
        elseif is_out[row] then char = "┤" end
        if row == op_row then
            char = (is_out[row] and row ~= outs[1] and row ~= outs[count]) and "┼" or "├"
            rows[row] = joined(padded(rows[row], reach), { seg(char .. "─▶ ", wire) }, op)
        else
            rows[row] = joined(padded(rows[row], reach), { seg(char, wire) })
        end
    end
    return make(rows, op_row)
end

local function reference(ctx, child_block, node)
    ctx.count = ctx.count + 1
    local number = ctx.count
    local out = with_wire(child_block, nil, node.type, true)
    ctx.extras[#ctx.extras + 1] = { number = number, block = out }
    return make({ { seg("↳ (" .. number .. ")", "AlmadarCircuitRung") } }, 1, true)
end

local function ladder_block(node, ctx)
    local lines, start = {}, 1
    local header = { seg(glyphs.ladder .. " " .. node.label, "AlmadarCircuitKeyword") }
    lines[1] = header
    local saved = ctx.maxw
    for index, child in ipairs(node.children) do
        local prefix = { seg("  " .. index .. " ▶ ", "AlmadarCircuitRung") }
        ctx.maxw = saved - line_width(prefix)
        local rung = with_prefix(compose(child, ctx), prefix)
        for _, line in ipairs(rung.lines) do lines[#lines + 1] = line end
        start = start + 1
    end
    ctx.maxw = saved
    return make(lines, 1)
end

compose = function(node, ctx)
    if node.kind == "binding" or node.kind == "literal" then return leaf_block(node) end
    if node.kind == "lambda" then return lambda_block(node, ctx) end
    if node.form == "ladder" then return ladder_block(node, ctx) end
    local entries, leaves = {}, {}
    for index, child in ipairs(node.children or {}) do
        if node.form == "actuator" and is_leaf(child) then
            leaves[#leaves + 1] = child
        else
            entries[#entries + 1] = {
                block = compose(child, ctx), tag = tag_for(node, index), type = child.type, node = child,
            }
        end
    end
    local op = operator_segments(node, leaves)
    if #entries == 0 then return make({ op }, 1) end
    local block = assemble(node, entries, op)
    while block.w > ctx.maxw do
        local pick
        for index, entry in ipairs(entries) do
            if not entry.block.leaf and (not pick or entry.block.w > entries[pick].block.w) then pick = index end
        end
        if not pick then break end
        entries[pick].block = reference(ctx, entries[pick].block, entries[pick].node)
        entries[pick].type = entries[pick].node.type
        block = assemble(node, entries, op)
    end
    return block
end

local function title(text)
    return { { seg(text, "AlmadarCircuitTitle") } }
end

--- Lay out one CircuitNode transition. Returns text lines and highlight spans.
---@param circuit table  { from, to, event, root }
---@param maxw integer   window width in cells
function M.layout(circuit, maxw)
    local ctx = { maxw = maxw, extras = {}, count = 0 }
    local rows = {}
    local function add(line) rows[#rows + 1] = line end
    add({ seg(circuit.from, "AlmadarCircuitBinding"), seg(" ──", "AlmadarCircuitWire"),
        seg(circuit.event, "AlmadarCircuitKeyword"), seg("──▶ ", "AlmadarCircuitWire"),
        seg(circuit.to, "AlmadarCircuitBinding") })
    local root = circuit.root
    for index, name in ipairs(root.names or {}) do
        local node = root.children[index]
        add({})
        add({ seg(name, "AlmadarCircuitTitle") })
        add({})
        if name == "effects" then
            ctx.maxw = maxw
            for rung, effect in ipairs(node.children) do
                local prefix = { seg(rung .. " ▶ ", "AlmadarCircuitRung") }
                ctx.maxw = maxw - line_width(prefix)
                local block = with_prefix(compose(effect, ctx), prefix)
                if rung > 1 then add({}) end
                for _, line in ipairs(block.lines) do add(line) end
            end
        else
            local suffix = { seg("▶ ✓ fires / ✗ blocked", "AlmadarCircuitWire") }
            ctx.maxw = maxw - line_width(suffix) - 12
            local block = with_wire(compose(node, ctx), nil, node.type)
            local last = block.lines[block.out]
            block.lines[block.out] = joined(last, suffix)
            for _, line in ipairs(block.lines) do add(line) end
        end
    end
    for _, extra in ipairs(ctx.extras) do
        add({})
        add({ seg("↳ (" .. extra.number .. ")", "AlmadarCircuitRung") })
        for _, line in ipairs(extra.block.lines) do add(line) end
    end
    local lines, spans = {}, {}
    for row, line in ipairs(rows) do
        local text, col = "", 0
        for _, part in ipairs(line) do
            if part[2] and #part[1] > 0 then spans[#spans + 1] = { row - 1, col, col + #part[1], part[2] } end
            text = text .. part[1]
            col = col + #part[1]
        end
        local trimmed = text:gsub("%s+$", "")
        lines[row] = trimmed
        for index = #spans, 1, -1 do
            local span = spans[index]
            if span[1] ~= row - 1 then break end
            span[3] = math.min(span[3], #trimmed)
            if span[3] <= span[2] then table.remove(spans, index) end
        end
    end
    return lines, spans
end

---@param buf integer
---@param circuit table
---@param maxw integer
function M.paint(buf, circuit, maxw)
    define_highlights()
    local lines, spans = M.layout(circuit, maxw)
    vim.bo[buf].modifiable = true
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.api.nvim_buf_clear_namespace(buf, M.namespace, 0, -1)
    for _, span in ipairs(spans) do
        vim.api.nvim_buf_set_extmark(buf, M.namespace, span[1], span[2], { end_col = span[3], hl_group = span[4] })
    end
    vim.bo[buf].modifiable = false
    return lines
end

local name = "almadar://circuit"

--- Whether the circuit split is on screen.
---@return boolean
function M.visible()
    local buf = vim.fn.bufnr(name)
    return buf ~= -1 and vim.fn.bufwinid(buf) ~= -1
end

--- Open or reuse the `almadar://circuit` scratch split and paint into it, keeping the cursor where it was.
---@param circuit table
function M.show(circuit)
    local buf = vim.fn.bufnr(name)
    if buf == -1 or not vim.api.nvim_buf_is_valid(buf) then
        buf = vim.api.nvim_create_buf(false, true)
        vim.api.nvim_buf_set_name(buf, name)
        vim.bo[buf].buftype, vim.bo[buf].bufhidden, vim.bo[buf].swapfile = "nofile", "hide", false
        vim.bo[buf].filetype = "orb-circuit"
        vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buf, silent = true })
    end
    local window = vim.fn.bufwinid(buf)
    if window == -1 then
        local previous = vim.api.nvim_get_current_win()
        vim.cmd("botright " .. math.max(40, math.floor(vim.o.columns * 0.45)) .. "vsplit")
        window = vim.api.nvim_get_current_win()
        vim.api.nvim_win_set_buf(window, buf)
        vim.wo[window].wrap, vim.wo[window].number, vim.wo[window].signcolumn = false, false, "no"
        vim.api.nvim_set_current_win(previous)
    end
    M.paint(buf, circuit, vim.api.nvim_win_get_width(window))
end

return M
