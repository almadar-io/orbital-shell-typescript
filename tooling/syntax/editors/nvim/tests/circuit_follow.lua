local test = debug.getinfo(1, "S").source:sub(2)
local plugin = vim.fs.dirname(vim.fs.dirname(test))
vim.opt.rtp:prepend(plugin)
local root = assert(vim.env.ALMADAR_WORKSPACE, "ALMADAR_WORKSPACE is required")
local bin = assert(vim.env.ORB_BIN, "ORB_BIN is required")
local program = root .. "/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-inspector.lolo"
local source = root .. "/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-trace-route.lolo"
local messages = {}
vim.notify = function(message) messages[#messages + 1] = message end
require("almadar.config").setup({ inspector = { command = { bin, "run", program }, cwd = root } })
vim.cmd.edit(vim.fn.fnameescape(source))
local source_buffer = vim.api.nvim_get_current_buf()
local source_window = vim.api.nvim_get_current_win()
local lines = vim.api.nvim_buf_get_lines(source_buffer, 0, -1, false)
local function line_of(text)
    for index, line in ipairs(lines) do
        if line:find(text, 1, true) then return index end
    end
    error("missing line: " .. text)
end
local function circuit_text()
    local buffer = vim.fn.bufnr("almadar://circuit")
    if buffer == -1 then return nil end
    return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
end
local inspector = require("almadar.inspector")

vim.api.nvim_win_set_cursor(source_window, { line_of("REQUEST_RECEIVED -> serving"), 8 })
inspector.circuit()
assert(vim.wait(60000, function() return circuit_text() ~= nil end, 20), "circuit never drawn without an open inspector: " .. table.concat(messages, " | "))
local first = circuit_text()
assert(first:find("REQUEST_RECEIVED", 1, true), first)
assert(first:find("str/startsWith", 1, true), first)
assert(vim.api.nvim_get_current_win() == source_window, "the circuit took the cursor")
assert(inspector.status().window == nil, "the circuit opened the inspector diagram too")
local circuit_window = vim.fn.bufwinid(vim.fn.bufnr("almadar://circuit"))
local source_position = vim.api.nvim_win_get_position(source_window)
local circuit_position = vim.api.nvim_win_get_position(circuit_window)
assert(circuit_position[1] == source_position[1] and circuit_position[2] > source_position[2], "the circuit is not to the right")
assert(vim.api.nvim_win_get_width(circuit_window) >= math.floor(vim.o.columns * 0.4), "the circuit is too narrow: " .. vim.api.nvim_win_get_width(circuit_window) .. " of " .. vim.o.columns)

vim.api.nvim_win_set_cursor(source_window, { line_of('(!= (str/upper @p.method) "GET")'), 8 })
vim.api.nvim_exec_autocmds("CursorMoved", { buffer = source_buffer })
assert(vim.wait(20000, function()
    local text = circuit_text()
    return text ~= nil and text:find("ROUTE_EXTERNAL", 1, true) ~= nil
end, 20), "circuit did not follow the cursor: " .. tostring(circuit_text()))
local second = circuit_text()
assert(second:find("array/some", 1, true) and second:find("str/upper", 1, true), second)
assert(vim.api.nvim_get_current_win() == source_window, "following took the cursor")

inspector.open()
local diagram_window = inspector.status().window
assert(diagram_window and vim.api.nvim_win_is_valid(diagram_window), "the inspector diagram did not open after the circuit")
assert(#vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(diagram_window), 0, -1, false) > 1, "the diagram is empty")
inspector.close()
print("circuit follow: opens the inspector on demand, follows the cursor across transitions, keeps the cursor")
vim.cmd("qa!")
