local source = debug.getinfo(1, "S").source:gsub("^@", "")
local tests = vim.fs.dirname(vim.fs.normalize(vim.fn.fnamemodify(source, ":p")))
vim.opt.runtimepath:append(vim.fs.dirname(tests))
local errors = {}
vim.notify = function(message, level)
    if level == vim.log.levels.ERROR then errors[#errors + 1] = message end
end
require("almadar.config").setup({ inspector = {
    command = { "python3", tests .. "/fixtures/inspector_focus.py" },
} })
local buf = vim.api.nvim_create_buf(false, true)
vim.api.nvim_buf_set_name(buf, vim.fn.tempname() .. ".lolo")
vim.api.nvim_buf_set_lines(buf, 0, -1, false, { "休憩 α", "second", "ambiguous", "outside", "stale" })
vim.api.nvim_win_set_buf(0, buf)
local source_window = vim.api.nvim_get_current_win()
local inspector = require("almadar.inspector")
local function wait_for(predicate, description)
    assert(vim.wait(5000, function() return #errors > 0 or predicate() end, 5), description)
    assert(#errors == 0, table.concat(errors, "\n"))
end
local function move(line, byte_column)
    vim.api.nvim_set_current_win(source_window)
    vim.api.nvim_win_set_cursor(source_window, { line, byte_column or 0 })
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = buf })
end
local function selected_count()
    local count = 0
    local diagram = require("almadar.diagram")
    for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(inspector.status().buffer, diagram.namespace, 0, -1, { details = true })) do
        if mark[4].hl_group == "AlmadarDiagramSelected" then count = count + 1 end
    end
    return count
end
local ok, failure = xpcall(function()
    inspector.open()
    wait_for(function() return inspector.status().layout ~= nil end, "initial fixture layout")
    move(1, 6)
    wait_for(function()
        local focus = inspector.status().selection.focus
        return focus and focus.nodeIds[1] == "first"
    end, "native focus using Unicode scalar coordinates")
    assert(selected_count() > 0)
    move(2)
    wait_for(function()
        local status = inspector.status()
        return status.selection.trait == "second" and status.layout.nodes[1].id == "second"
    end, "native focus changes trait and renders its provided graph")
    assert(selected_count() > 0)
    move(3)
    wait_for(function()
        return vim.wo[inspector.status().window].winbar:find("multiple traits", 1, true) ~= nil
    end, "ambiguity is surfaced without selecting another trait")
    assert(inspector.status().selection.trait == "second")
    move(4)
    wait_for(function() return selected_count() == 0 end, "outside scope clears highlight")
    move(5)
    vim.wait(100, function() return false end)
    assert(selected_count() == 0, "old document version must not update focus")
    assert(inspector.status().selection.focus.nodeIds[1] == nil)
end, debug.traceback)
inspector.close()
vim.api.nvim_buf_delete(buf, { force = true })
assert(ok, failure)
print("inspector focus: real subprocess, Unicode scalar cursor, trait switch, ambiguity and stale versions passed")
