local M = {}
M.namespace = vim.api.nvim_create_namespace("almadar.diagram")
local views = {}
local bit = require("bit")
local strokes = {
    [1] = "│", [2] = "─", [3] = "└", [4] = "│", [5] = "│", [6] = "┌", [7] = "├",
    [8] = "─", [9] = "┘", [10] = "─", [11] = "┴", [12] = "┐", [13] = "┤", [14] = "┬", [15] = "┼",
}

local function text_lines(label)
    assert(type(label) == "string", "diagram label must be a string")
    assert(not label:find("\t", 1, true), "diagram labels must supply explicit spaces instead of tabs")
    return vim.split(label, "\n", { plain = true })
end

local function dimensions(label)
    local lines, width = text_lines(label), 0
    for _, line in ipairs(lines) do
        width = math.max(width, vim.fn.strdisplaywidth(line))
    end
    return width, #lines
end

function M.measure(graph)
    local result = { nodes = {}, edges = {} }
    for _, node in ipairs(graph.nodes) do
        local width, height = dimensions(node.label)
        result.nodes[#result.nodes + 1] = { id = node.id, label = node.label, width = width + 4, height = height + 2 }
    end
    for _, edge in ipairs(graph.edges) do
        local width, height = dimensions(edge.label)
        result.edges[#result.edges + 1] = {
            id = edge.id, label = edge.label, labelWidth = width, labelHeight = height,
        }
    end
    return result
end

local function integer(value)
    return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function raster(layout)
    assert(integer(layout.width) and integer(layout.height), "diagram dimensions must be nonnegative integer cells")
    local cells, arrows = {}, {}
    for y = 0, layout.height - 1 do
        cells[y] = {}
        for x = 0, layout.width - 1 do
            cells[y][x] = { text = " " }
        end
    end
    local function put(x, y, text, owner)
        assert(integer(x) and integer(y) and cells[y] and cells[y][x], "diagram geometry exceeds canvas")
        cells[y][x] = { text = text, owner = owner }
    end
    local function write(x, y, label, owner)
        for line_index, line in ipairs(text_lines(label)) do
            local column, prefix, previous = x, "", nil
            for char_index = 0, vim.fn.strchars(line) - 1 do
                local char = vim.fn.strcharpart(line, char_index, 1)
                local before = vim.fn.strdisplaywidth(prefix)
                prefix = prefix .. char
                local width = vim.fn.strdisplaywidth(prefix) - before
                if width == 0 and previous then
                    cells[y + line_index - 1][previous].text = cells[y + line_index - 1][previous].text .. char
                else
                    put(column, y + line_index - 1, char, owner)
                    previous = column
                    for offset = 1, width - 1 do
                        put(column + offset, y + line_index - 1, "", owner)
                    end
                    column = column + width
                end
            end
        end
    end
    local function stroke(x, y, directions, owner)
        assert(integer(x) and integer(y) and cells[y] and cells[y][x], "diagram route exceeds canvas")
        local cell = cells[y][x]
        cell.directions = bit.bor(cell.directions or 0, directions)
        cell.text, cell.owner = strokes[cell.directions], owner
    end
    for _, edge in ipairs(layout.edges) do
        local owner = { kind = "edge", id = edge.id }
        assert(#edge.points >= 2, "diagram edge requires a routed path")
        for index = 2, #edge.points do
            local first, last = edge.points[index - 1], edge.points[index]
            assert(first.x == last.x or first.y == last.y, "diagram routes must be orthogonal")
            if first.y == last.y then
                for x = math.min(first.x, last.x), math.max(first.x, last.x) do
                    stroke(x, first.y, 10, owner)
                end
            else
                for y = math.min(first.y, last.y), math.max(first.y, last.y) do
                    stroke(first.x, y, 5, owner)
                end
            end
        end
        for index = 2, #edge.points - 1 do
            local before, point, after = edge.points[index - 1], edge.points[index], edge.points[index + 1]
            local directions = 0
            for _, other in ipairs({ before, after }) do
                if other.x < point.x then directions = bit.bor(directions, 8)
                elseif other.x > point.x then directions = bit.bor(directions, 2)
                elseif other.y < point.y then directions = bit.bor(directions, 1)
                elseif other.y > point.y then directions = bit.bor(directions, 4) end
            end
            put(point.x, point.y, strokes[directions] or "·", owner)
        end
        local last = edge.points[#edge.points]
        for index = #edge.points - 1, 1, -1 do
            local previous = edge.points[index]
            if previous.x ~= last.x or previous.y ~= last.y then
                local arrow
                if last.x > previous.x then arrow = "▶"
                elseif last.x < previous.x then arrow = "◀"
                elseif last.y > previous.y then arrow = "▼"
                else arrow = "▲" end
                arrows[#arrows + 1] = { x = last.x, y = last.y, text = arrow, owner = owner }
                break
            end
        end
        local width, height = dimensions(edge.label)
        assert(edge.labelWidth >= width and edge.labelHeight >= height, "diagram edge label measurements are too small")
        write(edge.labelX, edge.labelY, edge.label, owner)
    end
    for _, node in ipairs(layout.nodes) do
        local width, height = dimensions(node.label)
        assert(integer(node.width) and integer(node.height) and node.width >= width + 4 and node.height >= height + 2,
            "diagram node measurements are too small")
        local owner = { kind = "node", id = node.id }
        for y = node.y, node.y + node.height - 1 do
            for x = node.x, node.x + node.width - 1 do put(x, y, " ", owner) end
        end
        for x = node.x + 1, node.x + node.width - 2 do
            put(x, node.y, "─", owner)
            put(x, node.y + node.height - 1, "─", owner)
        end
        for y = node.y + 1, node.y + node.height - 2 do
            put(node.x, y, "│", owner)
            put(node.x + node.width - 1, y, "│", owner)
        end
        put(node.x, node.y, "┌", owner)
        put(node.x + node.width - 1, node.y, "┐", owner)
        put(node.x, node.y + node.height - 1, "└", owner)
        put(node.x + node.width - 1, node.y + node.height - 1, "┘", owner)
        write(node.x + 2, node.y + 1, node.label, owner)
    end
    for _, arrow in ipairs(arrows) do put(arrow.x, arrow.y, arrow.text, arrow.owner) end
    return cells
end

local function define_highlights()
    local definitions = {
        Node = { link = "Normal" }, Edge = { link = "Comment" }, Selected = { reverse = true, bold = true },
        Active = { bold = true, underline = true }, Fired = { bold = true, underline = true },
        Visited = { italic = true },
    }
    for name, definition in pairs(definitions) do
        definition.default = true
        vim.api.nvim_set_hl(0, "AlmadarDiagram" .. name, definition)
    end
end

local function highlight(view, opts)
    define_highlights()
    vim.api.nvim_buf_clear_namespace(view.buf, M.namespace, 0, -1)
    local visited_nodes, visited_edges, selected_nodes, selected_edges, active_nodes, fired_edges = {}, {}, {}, {}, {}, {}
    for _, id in ipairs(opts.visitedNodeIds or {}) do visited_nodes[id] = true end
    for _, id in ipairs(opts.visitedEdgeIds or {}) do visited_edges[id] = true end
    for _, id in ipairs(opts.selectedNodeIds or {}) do selected_nodes[id] = true end
    for _, id in ipairs(opts.selectedEdgeIds or {}) do selected_edges[id] = true end
    for _, id in ipairs(opts.activeNodeIds or {}) do active_nodes[id] = true end
    for _, id in ipairs(opts.firedEdgeIds or {}) do fired_edges[id] = true end
    for y = 0, view.height - 1 do
        local column = 0
        for x = 0, view.width - 1 do
            local cell = view.cells[y][x]
            local owner, group = cell.owner, nil
            if owner then
                if (owner.kind == "node" and (owner.id == opts.selectedNodeId or selected_nodes[owner.id]))
                    or (owner.kind == "edge" and (owner.id == opts.selectedEdgeId or selected_edges[owner.id])) then group = "Selected"
                elseif owner.kind == "node" and (owner.id == opts.activeNodeId or active_nodes[owner.id]) then group = "Active"
                elseif owner.kind == "edge" and (owner.id == opts.firedEdgeId or fired_edges[owner.id]) then group = "Fired"
                elseif (owner.kind == "node" and visited_nodes[owner.id])
                    or (owner.kind == "edge" and visited_edges[owner.id]) then group = "Visited"
                elseif owner.kind == "node" then group = "Node"
                else group = "Edge" end
            end
            if group and #cell.text > 0 then
                vim.api.nvim_buf_set_extmark(view.buf, M.namespace, y, column, {
                    end_col = column + #cell.text, hl_group = "AlmadarDiagram" .. group,
                })
            end
            column = column + #cell.text
        end
    end
end

function M.hit_test(buf, row, col)
    local view = views[buf]
    if not view or not view.cells[row] or not view.cells[row][col] then return nil end
    local owner = view.cells[row][col].owner
    return owner and vim.deepcopy(owner) or nil
end

function M.update(buf, opts)
    assert(views[buf], "diagram buffer has not been rendered")
    highlight(views[buf], opts or {})
end

function M.render(buf, layout, opts)
    local cells, lines = raster(layout), {}
    for y = 0, layout.height - 1 do
        local line = {}
        for x = 0, layout.width - 1 do line[#line + 1] = cells[y][x].text end
        lines[#lines + 1] = table.concat(line)
    end
    vim.bo[buf].buftype, vim.bo[buf].bufhidden, vim.bo[buf].swapfile = "nofile", "wipe", false
    vim.bo[buf].modifiable = true
    vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
    vim.bo[buf].modifiable = false
    if not views[buf] then
        vim.api.nvim_create_autocmd("BufWipeout", {
            buffer = buf, once = true, callback = function() views[buf] = nil end,
        })
    end
    views[buf] = { buf = buf, cells = cells, width = layout.width, height = layout.height }
    highlight(views[buf], opts or {})
    return {
        hit_test = function(row, col) return M.hit_test(buf, row, col) end,
        update = function(options) M.update(buf, options) end,
    }
end

return M
