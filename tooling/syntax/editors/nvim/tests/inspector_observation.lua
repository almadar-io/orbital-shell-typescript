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
local source_buffer = vim.api.nvim_create_buf(false, true)
vim.api.nvim_buf_set_name(source_buffer, vim.fn.tempname() .. ".lolo")
vim.api.nvim_buf_set_lines(source_buffer, 0, -1, false, { "fixture", "second" })
vim.api.nvim_win_set_buf(0, source_buffer)
local source_window = vim.api.nvim_get_current_win()
local inspector = require("almadar.inspector")
local function wait_for(predicate, description)
    assert(vim.wait(5000, function() return #errors > 0 or predicate() end, 5), description)
    assert(#errors == 0, table.concat(errors, "\n"))
end
local function active_marks()
    local diagram, count = require("almadar.diagram"), 0
    for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(inspector.status().buffer, diagram.namespace, 0, -1, { details = true })) do
        if mark[4].hl_group == "AlmadarDiagramActive" or mark[4].hl_group == "AlmadarDiagramSelectedActive" then count = count + 1 end
    end
    return count
end
local ok, failure = xpcall(function()
    inspector.open()
    wait_for(function() return inspector.status().layout ~= nil end, "initial diagram")
    inspector.attach("fixture://mismatches", "/trace", "runtime-1")
    wait_for(function() return #inspector.status().traceMessages == 4 end, "rejected context updates retained")
    assert(not inspector.status().observation and active_marks() == 0)
    inspector.detach()
    assert(not inspector.status().attachment)
    inspector.attach("fixture://valid", "/trace", "runtime-1")
    wait_for(function() return #inspector.status().traceMessages == 10 end, "compatible projection and stale sequence")
    local status = inspector.status()
    assert(status.observation.sequence == 3 and status.observation.activeNodeIds[1] == "first")
    assert(status.observation.frames[1].stateEntityId == "row-1")
    assert(active_marks() > 0)
    vim.api.nvim_set_current_win(source_window)
    vim.api.nvim_win_set_cursor(source_window, { 2, 0 })
    vim.api.nvim_exec_autocmds("CursorMoved", { buffer = source_buffer })
    wait_for(function()
        local state = inspector.status()
        return state.layout.nodes[1].id == "second" and state.observation and state.observation.traitId == "second"
    end, "cached native diagram notification arrives before matching layout")
    assert(active_marks() > 0)
    assert(inspector.status().traceMessages[11].method == "diagram")
    inspector.trace()
    local trace = table.concat(vim.api.nvim_buf_get_lines(0, 0, -1, false), "\n")
    assert(trace:find(string.rep("字", 400), 1, true), "full native trace details must survive")
    assert(trace:find("row-1", 1, true))
    vim.cmd.close()
    inspector.refresh()
    assert(not inspector.status().observation and active_marks() == 0, "refresh clears old runtime projection immediately")
    wait_for(function() return inspector.status().layout ~= nil end, "refreshed layout")
    inspector.detach()
    inspector.attach("fixture://ambiguity", "/trace", "runtime-1")
    wait_for(function()
        return vim.wo[inspector.status().window].winbar:find("binding is ambiguous", 1, true) ~= nil
    end, "native binding findings are visibly apparent")
    assert(inspector.status().observation.bindingIssues[1].code == "AMBIGUOUS_SOURCE_DECLARATION")
    assert(active_marks() == 0, "ambiguous source frames must not be highlighted")
    inspector.detach()
    inspector.attach("fixture://disconnect", "/trace", "runtime-1")
    wait_for(function() return #inspector.status().traceMessages == 24 end, "explicit disconnect notification")
    assert(not inspector.status().observation and not inspector.status().attachment and active_marks() == 0)
end, debug.traceback)
inspector.close()
vim.api.nvim_buf_delete(source_buffer, { force = true })
assert(ok, failure)
print("inspector observation: exact document/trait/instance checks, sequence, complete traces, refresh and disconnect passed")
