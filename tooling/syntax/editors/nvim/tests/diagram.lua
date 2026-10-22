local source = debug.getinfo(1, "S").source:gsub("^@", "")
local root = vim.fs.dirname(vim.fs.dirname(vim.fs.normalize(source)))
vim.opt.runtimepath:append(root)
local diagram = require("almadar.diagram")
local function equal(actual, expected)
    assert(vim.deep_equal(actual, expected), vim.inspect(actual) .. " ~= " .. vim.inspect(expected))
end

local measured = diagram.measure({
    nodes = { { id = "a", label = "休憩\nready" }, { id = "b", label = "café" } },
    edges = { { id = "ab", label = "続行\nguard" } },
})
equal(measured.nodes[1], { id = "a", label = "休憩\nready", width = 9, height = 4 })
equal(measured.edges[1], { id = "ab", label = "続行\nguard", labelWidth = 5, labelHeight = 2 })
equal(diagram.measure({ nodes = { { id = "accent", label = "é" } }, edges = {} }).nodes[1].width, 5)

local layout = {
    width = 36,
    height = 15,
    nodes = {
        { id = "a", label = "休憩", width = 8, height = 3, x = 2, y = 3, rank = 0 },
        { id = "b", label = "run", width = 7, height = 3, x = 25, y = 3, rank = 1 },
    },
    edges = {
        { id = "ab", source = "a", target = "b", label = "go", labelWidth = 2, labelHeight = 1,
            labelX = 16, labelY = 3, points = { { x = 10, y = 4 }, { x = 24, y = 4 } } },
        { id = "ab2", source = "a", target = "b", label = "again", labelWidth = 5, labelHeight = 1,
            labelX = 15, labelY = 9, points = { { x = 6, y = 6 }, { x = 6, y = 8 },
                { x = 28, y = 8 }, { x = 28, y = 6 } } },
        { id = "loop", source = "a", target = "a", label = "wait", labelWidth = 4, labelHeight = 1,
            labelX = 4, labelY = 0, points = { { x = 4, y = 2 }, { x = 4, y = 1 },
                { x = 8, y = 1 }, { x = 8, y = 2 } } },
    },
}
local buf = vim.api.nvim_create_buf(false, true)
local view = diagram.render(buf, layout, { activeNodeId = "a", firedEdgeId = "ab" })
equal(view.hit_test(4, 5), { kind = "node", id = "a" })
equal(view.hit_test(4, 6), { kind = "node", id = "a" })
equal(view.hit_test(4, 17), { kind = "edge", id = "ab" })
equal(view.hit_test(8, 17), { kind = "edge", id = "ab2" })
equal(view.hit_test(1, 6), { kind = "edge", id = "loop" })
equal(view.hit_test(14, 35), nil)
equal(diagram.hit_test(buf, 9, 16), { kind = "edge", id = "ab2" })
local lines = vim.api.nvim_buf_get_lines(buf, 0, -1, false)
assert(lines[5]:find("休憩", 1, true))
assert(lines[5]:find("▶", 1, true))
assert(lines[7]:find("▲", 1, true))
assert(lines[3]:find("▼", 1, true))
for _, line in ipairs(lines) do
    equal(vim.fn.strdisplaywidth(line), layout.width)
end
local function groups()
    local found = {}
    for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, diagram.namespace, 0, -1, { details = true })) do
        found[mark[4].hl_group] = true
    end
    return found
end
assert(groups().AlmadarDiagramActive)
assert(groups().AlmadarDiagramFired)
assert(not groups().AlmadarDiagramSelected)
view.update({ selectedEdgeId = "loop", visitedNodeIds = { "b" }, visitedEdgeIds = { "ab2" } })
equal(vim.api.nvim_buf_get_lines(buf, 0, -1, false), lines)
assert(groups().AlmadarDiagramSelected)
assert(groups().AlmadarDiagramVisited)
assert(not groups().AlmadarDiagramActive)
assert(not groups().AlmadarDiagramFired)
view.update({ selectedEdgeIds = { "ab", "ab2" } })
local selected_rows = {}
for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, diagram.namespace, 0, -1, { details = true })) do
    if mark[4].hl_group == "AlmadarDiagramSelected" then selected_rows[mark[2]] = true end
end
assert(selected_rows[4] and selected_rows[8], "all source-transition visual arms must highlight")
view.update({ activeNodeIds = { "a", "b" }, firedEdgeIds = { "ab", "ab2" } })
local active_rows, fired_rows = {}, {}
for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, diagram.namespace, 0, -1, { details = true })) do
    if mark[4].hl_group == "AlmadarDiagramActive" then active_rows[mark[2]] = true end
    if mark[4].hl_group == "AlmadarDiagramFired" then fired_rows[mark[2]] = true end
end
assert(active_rows[4] and fired_rows[4] and fired_rows[8], "all native frame states and completed edges must highlight")
local active_cells = 0
for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(buf, diagram.namespace, { 4, 0 }, { 4, -1 }, { details = true })) do
    if mark[4].hl_group == "AlmadarDiagramActive" then active_cells = active_cells + 1 end
end
equal(active_cells, 13)

local border_arrow = vim.deepcopy(layout)
border_arrow.edges[1].points[2].x = 25
local border_view = diagram.render(buf, border_arrow)
equal(border_view.hit_test(4, 25), { kind = "edge", id = "ab" })
assert(vim.api.nvim_buf_get_lines(buf, 4, 5, false)[1]:find("▶ run", 1, true))

local long_label = string.rep("字", 150)
local long_node = diagram.measure({ nodes = { { id = "long", label = long_label } }, edges = {} }).nodes[1]
long_node.x, long_node.y = 0, 0
diagram.render(buf, { width = long_node.width, height = long_node.height, nodes = { long_node }, edges = {} })
assert(vim.api.nvim_buf_get_lines(buf, 1, 2, false)[1]:find(long_label, 1, true))
local invalid = vim.deepcopy(layout)
invalid.edges[1].points[2].y = 5
assert(not pcall(diagram.render, buf, invalid), "diagonal routes must be rejected, not guessed")
local narrow = vim.deepcopy(layout)
narrow.nodes[1].width = 4
assert(not pcall(diagram.render, buf, narrow), "labels must never be truncated")
vim.api.nvim_buf_delete(buf, { force = true })
print("diagram: measurement, Unicode, loops, parallel routes, hits, overlays, full labels passed")
