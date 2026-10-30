--- AVL circuit painter: draws one transition's guard and effect tree as linear
--- bands. Each step is a square box, the boxes sit side by side on one line
--- joined by arrows, and a loop body sits in a frame around its own boxes. The
--- tree arrives finished from the inspector; this file only lays it out and paints it.
local M = {}
M.namespace = vim.api.nvim_create_namespace("almadar.circuit")

local MAX_BOX = 48
local wire = "AlmadarCircuitWire"
local groups = {
    block = "@function.builtin", series = "@operator", parallel = "@operator", invert = "@operator",
    branch = "@keyword", scope = "@keyword", template = "@function.builtin", conveyor = "@keyword",
    ladder = "@keyword", actuator = "AlmadarCircuitActuator", unknown = "@function.builtin",
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
local function parts_width(list)
    local total = 0
    for _, part in ipairs(list) do total = total + width(part[1]) end
    return total
end
local function append(into, list)
    for _, item in ipairs(list) do into[#into + 1] = item end
    return into
end
local function blank(cells) return { seg(string.rep(" ", cells)) } end

local function is_leaf(node) return node.kind == "binding" or node.kind == "literal" end
local function has_lambda(node)
    for _, child in ipairs(node.children or {}) do
        if child.kind == "lambda" then return true end
    end
    return false
end
local function inlinable(node)
    return is_leaf(node) or not (node.kind == "lambda" or has_lambda(node) or node.form == "scope" or node.form == "ladder")
end
local function leaf_hl(node)
    if node.kind == "literal" then return tonumber(node.label) and "AlmadarCircuitNumber" or "AlmadarCircuitString" end
    return "AlmadarCircuitBinding"
end
local function label_hl(node) return groups[node.form] or "AlmadarCircuitForm" end

--- One expression written inline. Arguments that cannot be inline (loops, lets) or that
--- the caller split out become the placeholder `●` and are recorded in ctx.forced.
local inline
local function list_of(nodes, ctx, open, close, keyed)
    local parts = { seg(open) }
    for index, child in ipairs(nodes) do
        if index > 1 then parts[#parts + 1] = seg(", ") end
        if keyed and keyed[index] then
            parts[#parts + 1] = seg(keyed[index] .. ": ")
        end
        append(parts, inline(child, ctx))
    end
    parts[#parts + 1] = seg(close)
    return parts
end

local function operand(node, ctx)
    local parts = inline(node, ctx)
    if node.infix and inlinable(node) and not ctx.skip[node] and not is_leaf(node) then
        return append(append({ seg("(") }, parts), { seg(")") })
    end
    return parts
end

inline = function(node, ctx)
    if ctx.skip[node] then return { seg("●", "AlmadarCircuitRung") } end
    if not inlinable(node) then
        ctx.forced[#ctx.forced + 1] = node
        return { seg("●", "AlmadarCircuitRung") }
    end
    if is_leaf(node) then
        local label = node.label
        if node.kind == "binding" and node.source then label = (label:gsub("^@", "")) end
        return { seg(label, leaf_hl(node)) }
    end
    local children = node.children or {}
    if node.kind == "object" then
        if #children == 0 then return { seg("{ }") } end
        local parts = list_of(children, ctx, "{ ", " }", node.names)
        return parts
    end
    if node.kind == "array" then return list_of(children, ctx, "[", "]") end
    if node.infix and #children >= 2 then
        local parts = operand(children[1], ctx)
        for index = 2, #children do
            parts[#parts + 1] = seg(" ")
            parts[#parts + 1] = seg(node.label, "AlmadarCircuitOperator")
            parts[#parts + 1] = seg(" ")
            append(parts, operand(children[index], ctx))
        end
        return parts
    end
    if node.form == "invert" and #children == 1 then
        return append({ seg(node.label .. " ", label_hl(node)) }, operand(children[1], ctx))
    end
    if node.form == "branch" and #children == 3 then
        local parts = { seg("if ", label_hl(node)) }
        append(parts, inline(children[1], ctx))
        parts[#parts + 1] = seg(" then ", label_hl(node))
        append(parts, inline(children[2], ctx))
        parts[#parts + 1] = seg(" else ", label_hl(node))
        return append(parts, inline(children[3], ctx))
    end
    return append({ seg(node.label, label_hl(node)) }, list_of(children, ctx, "(", ")"))
end

local chain

--- Items for one value: the steps that must run first, then its own box.
local function box_items(node, prefix)
    local ctx = { skip = {}, forced = {} }
    local function build()
        return append(append({}, prefix or {}), inline(node, ctx))
    end
    local parts, pre = build(), {}
    if #ctx.forced == 0 and parts_width(parts) > MAX_BOX then
        local widest, best = nil, -1
        for _, child in ipairs(node.children or {}) do
            if child.kind ~= "lambda" and not is_leaf(child) and inlinable(child) then
                local size = parts_width(inline(child, { skip = {}, forced = {} }))
                if size > best then widest, best = child, size end
            end
        end
        if widest then
            ctx = { skip = { [widest] = true }, forced = {} }
            parts = build()
            pre = chain(widest)
        end
    end
    for _, forced in ipairs(ctx.forced) do append(pre, chain(forced)) end
    pre[#pre + 1] = { box = parts, type = node.type }
    return pre
end

local function bound_items(node, name)
    if inlinable(node) then
        return box_items(node, { seg(name, "AlmadarCircuitBinding"), seg(" = ", wire) })
    end
    local items = chain(node)
    if #items > 0 then items[#items].bind = name end
    return items
end

local function conveyor_items(node)
    local collection, extras, lambdas = nil, {}, {}
    for _, child in ipairs(node.children or {}) do
        if child.kind == "lambda" then lambdas[#lambdas + 1] = child
        elseif not collection then collection = child
        else extras[#extras + 1] = child end
    end
    local items = collection and chain(collection) or {}
    local params = table.concat(lambdas[1].names or {}, " ")
    local parts = { seg("⇶ ", "AlmadarCircuitKeyword"),
        seg(node.label .. (params ~= "" and " " .. params or ""), "AlmadarCircuitKeyword") }
    if #extras > 0 then
        local ctx = { skip = {}, forced = {} }
        local extra_parts = list_of(extras, ctx, "", "")
        for _, forced in ipairs(ctx.forced) do append(items, chain(forced)) end
        parts[#parts + 1] = seg(" from ", "AlmadarCircuitKeyword")
        append(parts, extra_parts)
    end
    items[#items + 1] = { box = parts }
    for index, lambda in ipairs(lambdas) do
        items[#items + 1] = {
            frame = lambda.children[1] and chain(lambda.children[1]) or {},
            title = "for each " .. table.concat(lambda.names or {}, " "),
            type = index == #lambdas and node.type or nil,
        }
    end
    return items
end

chain = function(node)
    local children = node.children or {}
    if node.kind == "lambda" then return children[1] and chain(children[1]) or {} end
    if node.form == "scope" then
        local names, items = node.names or {}, {}
        for index, child in ipairs(children) do
            if index <= #names then append(items, bound_items(child, names[index]))
            else append(items, chain(child)) end
        end
        return items
    end
    if (node.form == "series" or node.form == "parallel") and #children > 0 then
        local items = {}
        for index, child in ipairs(children) do
            local sub = chain(child)
            if index > 1 and sub[1] then sub[1].tie = node.form == "series" and "⊓" or "⊔" end
            append(items, sub)
        end
        return items
    end
    if has_lambda(node) then return conveyor_items(node) end
    return box_items(node)
end

local function actuator_items(node)
    local items, parts = {}, { seg("⟹ ", "AlmadarCircuitActuator"), seg(node.label, "AlmadarCircuitActuator") }
    for _, child in ipairs(node.children or {}) do
        if is_leaf(child) then
            parts[#parts + 1] = seg(" ")
            append(parts, inline(child, { skip = {}, forced = {} }))
        else
            append(items, chain(child))
        end
    end
    items[#items + 1] = { box = parts }
    return items
end

local HUGE = math.huge
local MARKER_ROOM = 5

-- a block is rows of pieces, equally wide; arrows enter on row rin and leave from row rout
local function make_block(lines, rin, rout)
    return { lines = lines, rin = rin, rout = rout or rin, w = parts_width(lines[1]) }
end

--- Break pieces into lines of at most `limit` cells, at a space when one fits, else mid-word.
--- No character is dropped: the lines concatenate to the original text.
local soft = { [" "] = true, ["("] = true, [","] = true, ["["] = true, ["{"] = true }
local function wrap_parts(parts, limit)
    limit = math.max(limit, 1)
    local lines, current, used, space = {}, {}, 0, nil
    local function flush(upto)
        local head = {}
        for index = 1, upto do head[index] = current[index] end
        lines[#lines + 1] = head
        local rest = {}
        for index = upto + 1, #current do rest[#rest + 1] = current[index] end
        current, used, space = rest, 0, nil
        for index, char in ipairs(current) do
            used = used + width(char[1])
            if soft[char[1]] then space = index end
        end
    end
    for _, part in ipairs(parts) do
        for _, char in ipairs(vim.fn.split(part[1], "\\zs")) do
            local cells = width(char)
            if used + cells > limit and #current > 0 then flush(space or #current) end
            current[#current + 1] = { char, part[2] }
            used = used + cells
            if soft[char] then space = #current end
        end
    end
    if #current > 0 or #lines == 0 then flush(#current) end
    local out = {}
    for _, line in ipairs(lines) do
        local merged = {}
        for _, char in ipairs(line) do
            local last = merged[#merged]
            if last and last[2] == char[2] then last[1] = last[1] .. char[1] else merged[#merged + 1] = seg(char[1], char[2]) end
        end
        out[#out + 1] = merged
    end
    return out
end

local function pad_lines(lines)
    local widest = 0
    for _, line in ipairs(lines) do widest = math.max(widest, parts_width(line)) end
    local out = {}
    for index, line in ipairs(lines) do
        local missing = widest - parts_width(line)
        out[index] = missing > 0 and append(append({}, line), blank(missing)) or line
    end
    return out, widest
end

local function box_block(parts, limit)
    local inner_limit = limit - 4
    local lines = parts_width(parts) <= inner_limit and { parts } or wrap_parts(parts, inner_limit)
    local padded, inner = pad_lines(lines)
    local rows = { { seg("┌" .. string.rep("─", inner + 2) .. "┐", wire) } }
    for _, line in ipairs(padded) do
        rows[#rows + 1] = append(append({ seg("│ ", wire) }, line), { seg(" │", wire) })
    end
    rows[#rows + 1] = { seg("└" .. string.rep("─", inner + 2) .. "┘", wire) }
    return make_block(rows, 2)
end

local function text_block(parts, limit)
    local padded = pad_lines(parts_width(parts) <= limit and { parts } or wrap_parts(parts, limit))
    return make_block(padded, 1)
end

local function frame_block(title, inner, limit)
    local titles = wrap_parts({ seg(title, "AlmadarCircuitKeyword") }, math.max(limit - 6, 4))
    local title_width = 0
    for _, line in ipairs(titles) do title_width = math.max(title_width, parts_width(line)) end
    local size = math.max(inner.w + 4, title_width + 5)
    local first = append(append({ seg("┌ ", wire) }, titles[1]), { seg(" ", wire) })
    local lines = { append(first, { seg(string.rep("─", size - parts_width(first) - 1) .. "┐", wire) }) }
    for index = 2, #titles do
        lines[#lines + 1] = append(append({ seg("│ ", wire) }, titles[index]),
            { seg(string.rep(" ", size - 4 - parts_width(titles[index])) .. " │", wire) })
    end
    for _, line in ipairs(inner.lines) do
        lines[#lines + 1] = append(append({ seg("│ ", wire) }, line),
            { seg(string.rep(" ", size - 4 - inner.w) .. " │", wire) })
    end
    lines[#lines + 1] = { seg("└" .. string.rep("─", size - 2) .. "┘", wire) }
    return make_block(lines, #titles + inner.rin, #titles + inner.rout)
end

local function hjoin(left, joint, right)
    local joint_width = parts_width(joint)
    local up = math.max(left.rout, right.rin) - 1
    local left_at, right_at = up - (left.rout - 1), up - (right.rin - 1)
    local lines = {}
    for row = 1, math.max(left_at + #left.lines, right_at + #right.lines) do
        local line = append({}, left.lines[row - left_at] or blank(left.w))
        append(line, row == up + 1 and joint or blank(joint_width))
        lines[row] = append(line, right.lines[row - right_at] or blank(right.w))
    end
    return { lines = lines, rin = left.rin + left_at, rout = right.rout + right_at, w = left.w + joint_width + right.w }
end

--- Row groups stacked top to bottom: arrows enter the first group and leave the last.
local function stack(groups)
    local widest = 0
    for _, group in ipairs(groups) do widest = math.max(widest, group.w) end
    local lines, rin, rout = {}, groups[1].rin, nil
    for index, group in ipairs(groups) do
        local start = #lines
        for _, line in ipairs(group.lines) do
            lines[#lines + 1] = group.w < widest and append(append({}, line), blank(widest - group.w)) or line
        end
        if index == #groups then rout = start + group.rout end
    end
    return { lines = lines, rin = rin, rout = rout, w = widest }
end

local function arrow(item)
    local parts = { seg("─", wire) }
    if item.bind then
        parts[#parts + 1] = seg(item.bind, "AlmadarCircuitBinding")
        parts[#parts + 1] = seg("─", wire)
    end
    if item.type then
        parts[#parts + 1] = seg("‹" .. item.type .. "›", "AlmadarCircuitType")
        parts[#parts + 1] = seg("─", wire)
    end
    parts[#parts + 1] = seg("▶ ", wire)
    return parts
end

local function natural(piece)
    piece.natural = piece.natural or piece.make(HUGE)
    return piece.natural
end

--- The start of a wrapped row: `↳` and the joint, its type label wrapped when it is long.
local function row_start(piece, avail, reserve)
    local parts = append({ seg("↳", wire) }, piece.joint)
    local own = natural(piece).w
    local half = math.max(10, math.floor(avail / 2))
    if parts_width(parts) <= half or parts_width(parts) + own + reserve <= avail then return make_block({ parts }, 1) end
    local padded = pad_lines(wrap_parts(parts, math.max(10, math.floor(avail / 3), math.min(half, avail - own - reserve))))
    return make_block(padded, #padded)
end

--- Boxes flow left to right like words: a row that cannot take the next box and its arrow
--- ends with `─▶ ↵` and the next row starts with `↳─▶`.
local function flow(pieces, avail)
    avail = math.max(avail, 12)
    local groups, current = {}, nil
    for index, piece in ipairs(pieces) do
        local reserve = index == #pieces and 0 or MARKER_ROOM
        local fits = natural(piece)
        local joint = current and piece.joint or {}
        if current and current.w + parts_width(joint) + fits.w + reserve <= avail then
            current = hjoin(current, joint, fits)
        else
            local lead
            if current then
                local marker = piece.tie and "─" .. piece.tie .. "─ ↵" or "─▶ ↵"
                groups[#groups + 1] = hjoin(current, {}, make_block({ { seg(marker, wire) } }, 1))
                lead = row_start(piece, avail, reserve)
            end
            local room = avail - (lead and lead.w or 0) - reserve
            local placed = fits.w <= room and fits or piece.make(room)
            current = lead and hjoin(lead, {}, placed) or placed
        end
    end
    groups[#groups + 1] = current
    return stack(groups)
end

local function render_items(items, avail, tail)
    if #items == 0 then items = { { box = { seg("·") } } } end
    local pieces = {}
    for index, item in ipairs(items) do
        local piece = { tie = item.tie }
        if index > 1 then
            piece.joint = item.tie and { seg("─" .. item.tie .. "─", "AlmadarCircuitOperator") } or arrow(items[index - 1])
        end
        if item.frame then
            piece.make = function(limit)
                return frame_block(item.title, render_items(item.frame, limit - 4), limit)
            end
        else
            piece.make = function(limit) return box_block(item.box, limit) end
        end
        pieces[#pieces + 1] = piece
    end
    if tail then
        pieces[#pieces + 1] = {
            joint = arrow(items[#items]),
            make = function(limit) return text_block({ seg(tail, wire) }, limit) end,
        }
    end
    return flow(pieces, avail)
end

local function band(strip, avail)
    local node = strip.node
    local items = node.form == "actuator" and actuator_items(node) or chain(node)
    return render_items(items, avail, strip.guard and "✓ fires / ✗ blocked" or nil)
end

--- Lay out one CircuitNode transition. Returns text lines and highlight spans.
---@param circuit table  { from, to, event, root }
---@param maxw integer?  window width; nothing is laid out wider, nil leaves it unwrapped
function M.layout(circuit, maxw)
    maxw = maxw or HUGE
    local rows = wrap_parts({ seg(circuit.from, "AlmadarCircuitBinding"), seg(" ──", wire),
        seg(circuit.event, "AlmadarCircuitKeyword"), seg("──▶ ", wire),
        seg(circuit.to, "AlmadarCircuitBinding") }, maxw)
    local strips = {}
    local function collect(node, label)
        local prefix = label .. " ▶"
        if node.form == "ladder" then
            strips[#strips + 1] = { prefix = prefix, title = node }
            for index, child in ipairs(node.children) do collect(child, label .. "." .. index) end
        else
            strips[#strips + 1] = { prefix = prefix, node = node }
        end
    end
    local root = circuit.root
    for index, name in ipairs(root.names or {}) do
        local node = root.children[index]
        if name == "effects" then
            for rung, effect in ipairs(node.children) do collect(effect, tostring(rung)) end
        else
            strips[#strips + 1] = { prefix = name .. " ▶", node = node, guard = true }
        end
    end
    local indent = 0
    for _, strip in ipairs(strips) do indent = math.max(indent, width(strip.prefix) + 2) end
    for _, strip in ipairs(strips) do
        rows[#rows + 1] = {}
        if strip.title then
            rows[#rows + 1] = { seg(strip.prefix, "AlmadarCircuitRung"),
                seg(string.rep(" ", indent - width(strip.prefix))),
                seg("≡ " .. strip.title.label, "AlmadarCircuitKeyword") }
        else
            local block = band(strip, math.max(maxw - indent, 20))
            for index, line in ipairs(block.lines) do
                local lead = index == block.rin
                    and { seg(strip.prefix, "AlmadarCircuitRung"), seg(string.rep(" ", indent - width(strip.prefix))) }
                    or blank(indent)
                rows[#rows + 1] = append(lead, line)
            end
        end
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

local function draw(buf, circuit, maxw)
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

---@param buf integer
---@param circuit table
---@param maxw integer  window width: nothing is laid out wider
function M.paint(buf, circuit, maxw)
    vim.b[buf].almadar_circuit = circuit
    return draw(buf, circuit, maxw)
end

local name = "almadar://circuit"

--- Whether the circuit split is on screen.
---@return boolean
function M.visible()
    local buf = vim.fn.bufnr(name)
    return buf ~= -1 and vim.fn.bufwinid(buf) ~= -1
end

local function repaint()
    local buf = vim.fn.bufnr(name)
    if buf == -1 then return end
    local window = vim.fn.bufwinid(buf)
    local circuit = vim.b[buf].almadar_circuit
    if window ~= -1 and circuit then draw(buf, circuit, vim.api.nvim_win_get_width(window)) end
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
        vim.wo[window].sidescrolloff = 8
        if vim.o.sidescroll == 0 then vim.o.sidescroll = 1 end
        vim.api.nvim_set_current_win(previous)
    end
    vim.api.nvim_create_autocmd({ "WinResized", "VimResized" }, {
        group = vim.api.nvim_create_augroup("AlmadarCircuit", { clear = true }),
        callback = repaint,
    })
    M.paint(buf, circuit, vim.api.nvim_win_get_width(window))
end

return M
