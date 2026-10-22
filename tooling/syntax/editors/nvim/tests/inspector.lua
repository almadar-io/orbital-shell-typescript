local test = debug.getinfo(1, "S").source:sub(2)
local plugin = vim.fs.dirname(vim.fs.dirname(test))
vim.opt.rtp:prepend(plugin)
local root = assert(vim.env.ALMADAR_WORKSPACE, "ALMADAR_WORKSPACE is required")
local bin = assert(vim.env.ORB_BIN, "ORB_BIN is required")
local program = root .. "/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-inspector.lolo"
local source = root .. "/packages/almadar-std/behaviors/lolo/flow/atoms/std-retry.lolo"
local errors = {}
vim.notify = function(message, level)
    if level == vim.log.levels.ERROR then errors[#errors + 1] = message end
end
require("almadar.config").setup({ inspector = { command = { bin, "run", program } } })
vim.cmd.edit(vim.fn.fnameescape(source))
local source_buffer = vim.api.nvim_get_current_buf()
vim.ui.select = function(items, _, callback)
    for _, item in ipairs(items) do
        if item.orbital == "RetryOrbital" and item.trait == "Retry" then callback(item); return end
    end
    error("Retry machine missing from native program")
end
local inspector = require("almadar.inspector")
inspector.open()
assert(vim.wait(60000, function() return inspector.status().layout ~= nil or #errors > 0 end, 10), "native inspector timed out")
assert(#errors == 0, table.concat(errors, "\n"))
local status = inspector.status()
assert(status.running and status.selection.trait == "Retry")
assert(#status.layout.nodes == 3)
local lines = table.concat(vim.api.nvim_buf_get_lines(status.buffer, 0, -1, false), "\n")
assert(lines:find("idle", 1, true) and lines:find("running", 1, true) and lines:find("backoff", 1, true))
local source_node
for _, item in ipairs(status.selection.nodeSources) do
    if item.id == "backoff" then source_node = item end
end
assert(source_node and #source_node.sources > 0, "native state source location missing")
local anchor = source_node.sources[1]
local layout_node
for _, node in ipairs(status.layout.nodes) do if node.id == "backoff" then layout_node = node end end
vim.api.nvim_set_current_win(status.window)
local line = vim.api.nvim_buf_get_lines(status.buffer, layout_node.y + 1, layout_node.y + 2, false)[1]
local column = vim.fn.byteidx(line, vim.fn.strchars(line:match("^(.-)backoff")))
vim.api.nvim_win_set_cursor(status.window, { layout_node.y + 2, column })
inspector.jump()
assert(vim.api.nvim_get_current_buf() == source_buffer)
assert(vim.api.nvim_win_get_cursor(0)[1] == anchor.line)
assert(not vim.bo[source_buffer].modified)
inspector.close()
assert(not inspector.status().running)
print("inspector: native read, selection, layout, renderer, exact state navigation and teardown passed")
vim.cmd("qa!")
