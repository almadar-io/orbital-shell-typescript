local test = debug.getinfo(1, "S").source:sub(2)
local plugin = vim.fs.dirname(vim.fs.dirname(test))
vim.opt.rtp:prepend(plugin)
local root = assert(vim.env.ALMADAR_WORKSPACE, "ALMADAR_WORKSPACE is required")
local bin = assert(vim.env.ORB_BIN, "ORB_BIN is required")
local program = root .. "/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-inspector.lolo"
local source = root .. "/packages/almadar-std/behaviors/lolo/flow/atoms/std-retry.lolo"
local messages, prompted = {}, false
vim.notify = function(message) messages[#messages + 1] = message end
vim.ui.select = function() prompted = true end
require("almadar.config").setup({ inspector = { command = { bin, "run", program }, cwd = root } })
vim.cmd.edit(vim.fn.fnameescape(source))
local source_window = vim.api.nvim_get_current_win()
local target
for index, line in ipairs(vim.api.nvim_buf_get_lines(0, 0, -1, false)) do
    if line:find("FAILED -> backoff when", 1, true) then target = index; break end
end
assert(target, "FAILED -> backoff transition missing")
vim.api.nvim_win_set_cursor(source_window, { target, 8 })
local inspector = require("almadar.inspector")
inspector.circuit()
local function circuit_text()
    local buffer = vim.fn.bufnr("almadar://circuit")
    if buffer == -1 then return nil end
    return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
end
assert(vim.wait(60000, function() return circuit_text() ~= nil or prompted end, 20),
    "nothing drawn: " .. table.concat(messages, " | "))
assert(not prompted, "asked to choose a trait although the cursor is inside one")
local text = circuit_text()
assert(text:find("FAILED", 1, true) and text:find("backoff", 1, true), text)
assert(inspector.status().selection.trait == "Retry", "selected the trait under the cursor")
assert(vim.api.nvim_get_current_win() == source_window, "the circuit took the cursor")

inspector.close()
print("circuit traits: picks the trait under the cursor without asking")
vim.cmd("qa!")
