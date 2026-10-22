local config = require("almadar.config")
local diagram = require("almadar.diagram")
local M = {}
local session
local source_namespace = vim.api.nvim_create_namespace("almadar-inspector-source")

local function notify(message, level)
    vim.notify(message, level or vim.log.levels.ERROR, { title = "Orb inspector" })
end

local function request(method, params, callback)
    session.client.request(method, params, function(result, err)
        if err and err.code == "PROCESS_STOPPED" then return end
        if err then return notify(err.code .. ": " .. err.message) end
        if session then callback(result) end
    end)
end

local function current_version()
    return session and vim.api.nvim_buf_is_valid(session.source)
        and vim.api.nvim_buf_get_changedtick(session.source)
end

local function set_status(text)
    if session and vim.api.nvim_win_is_valid(session.window) then
        vim.wo[session.window].winbar = " " .. text:gsub("%%", "%%%%")
    end
end

local function clear_runtime()
    if not session then return end
    session.observation = nil
    if session.visual then
        session.visual.activeNodeIds, session.visual.firedEdgeIds = nil, nil
        if session.layout then diagram.update(session.buffer, session.visual) end
    end
end

local function receive_notification(method, params)
    if not session or method ~= "trace" then return end
    session.traceMessages[#session.traceMessages + 1] = params
    local attachment = session.attachment
    if not attachment then return end
    if params.type == "trace-disconnected"
        and (params.instance == attachment.instance or params.expectedInstance == attachment.instance) then
        clear_runtime()
        session.attachment = nil
        return set_status("Runtime observation disconnected · :OrbInspectTrace for details")
    end
    if not session.selection or not session.layout or not session.selection.machine then return end
    for _, update in ipairs(params.diagramUpdates or {}) do
        if update.path == vim.api.nvim_buf_get_name(session.source)
            and update.documentVersion == current_version()
            and update.documentVersion == session.program.version
            and update.traitId == session.selection.machine.id
            and update.instance == attachment.instance then
            local previous = session.observation
            if not previous or previous.programVersion ~= update.programVersion or update.sequence >= previous.sequence then
                session.observation = update
                session.visual.activeNodeIds, session.visual.firedEdgeIds = update.activeNodeIds, update.firedEdgeIds
                diagram.update(session.buffer, session.visual)
                set_status(session.selection.orbital .. " / " .. session.selection.trait
                    .. " · observed states / completed transitions · " .. update.instance .. " #" .. update.sequence)
            end
        end
    end
end

local function item_at_cursor()
    if not session then return end
    local row = vim.api.nvim_win_get_cursor(session.window)[1] - 1
    local col = vim.api.nvim_win_call(session.window, function() return vim.fn.virtcol(".") - 1 end)
    return diagram.hit_test(session.buffer, row, col)
end

local function sources_for(item)
    local entries = item.kind == "node" and session.selection.nodeSources or session.selection.edgeSources
    for _, entry in ipairs(entries or {}) do
        if entry.id == item.id then return entry.sources end
    end
    return {}
end

local function open_source(anchor)
    local target = vim.fn.bufadd(anchor.path)
    vim.fn.bufload(target)
    if not vim.api.nvim_win_is_valid(session.source_window) then
        vim.cmd("leftabove vsplit")
        session.source_window = vim.api.nvim_get_current_win()
    end
    vim.api.nvim_set_current_win(session.source_window)
    vim.api.nvim_win_set_buf(session.source_window, target)
    local line = vim.api.nvim_buf_get_lines(target, anchor.line - 1, anchor.line, false)[1] or ""
    local column = vim.str_byteindex(line, anchor.column - 1)
    vim.api.nvim_win_set_cursor(session.source_window, { anchor.line, column })
    vim.cmd("normal! zz")
    vim.api.nvim_buf_clear_namespace(target, source_namespace, 0, -1)
    vim.api.nvim_buf_set_extmark(target, source_namespace, anchor.line - 1, column, {
        line_hl_group = "Visual",
    })
    if not anchor.exact then notify("Source location is approximate", vim.log.levels.INFO) end
end

function M.status()
    if not session then return { running = false } end
    return {
        running = not session.client.closed,
        source = session.source,
        buffer = session.buffer,
        window = session.window,
        version = session.program and session.program.version,
        machine = session.machine,
        selection = session.selection,
        layout = session.layout,
        attachment = session.attachment,
        observation = session.observation,
        traceMessages = session.traceMessages,
    }
end

function M.jump()
    if not session or not session.program or current_version() ~= session.program.version then
        return notify("Source changed; wait for the diagram to refresh", vim.log.levels.INFO)
    end
    local item = item_at_cursor()
    if not item then return end
    local sources = sources_for(item)
    if #sources == 0 then return notify("The native reader has no source location for this element", vim.log.levels.INFO) end
    if #sources == 1 then return open_source(sources[1]) end
    vim.ui.select(sources, {
        prompt = "Source declaration",
        format_item = function(anchor)
            return anchor.path .. ":" .. anchor.line .. ":" .. anchor.column
                .. (anchor.exact and "" or " (approximate)")
        end,
    }, function(anchor) if anchor and session then open_source(anchor) end end)
end

function M.details()
    local item = item_at_cursor()
    if not item then return end
    local elements = item.kind == "node" and session.selection.graph.nodes or session.selection.graph.edges
    local selected
    for _, element in ipairs(elements) do
        if element.id == item.id then selected = element; break end
    end
    vim.cmd("belowright split")
    local buffer = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(0, buffer)
    vim.bo[buffer].buftype = "nofile"
    vim.bo[buffer].bufhidden = "wipe"
    vim.bo[buffer].filetype = "lua"
    local text = vim.inspect({
        element = selected, sources = sources_for(item), machine = session.selection.matches,
        composition = session.selection.composition,
        observation = session.observation,
    })
    vim.api.nvim_buf_set_lines(buffer, 0, -1, false, vim.split(text, "\n", { plain = true }))
    vim.bo[buffer].modifiable = false
    vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buffer })
end

local function render_selection(selection, version)
    if current_version() ~= version then return end
    clear_runtime()
    session.selection = selection
    local measured = diagram.measure(selection.graph)
    for index, edge in ipairs(measured.edges) do
        edge.source = selection.graph.edges[index].source
        edge.target = selection.graph.edges[index].target
    end
    request("layout", measured, function(result)
        if current_version() ~= version or session.selection ~= selection then return end
        session.layout = result.layout
        local focus = selection.focus or {}
        session.visual = { selectedNodeIds = focus.nodeIds, selectedEdgeIds = focus.edgeIds }
        diagram.render(session.buffer, result.layout, session.visual)
        set_status(selection.orbital .. " / " .. selection.trait .. "  ·  Enter source · K details · t trait · r refresh")
    end)
end

local function select_machine(machine, version)
    session.machine = machine
    request("select", { orbital = machine.orbital, trait = machine.trait }, function(result)
        render_selection(result, version)
    end)
end

function M.choose()
    if not session or not session.program then return end
    local version = session.program.version
    vim.ui.select(session.program.machines, {
        prompt = "Inspect a trait",
        format_item = function(machine) return machine.orbital .. " / " .. machine.trait end,
    }, function(machine)
        if machine and current_version() == version then select_machine(machine, version) end
    end)
end

function M.refresh()
    if not session or not current_version() then return end
    clear_runtime()
    local version = current_version()
    local source = table.concat(vim.api.nvim_buf_get_lines(session.source, 0, -1, false), "\n")
    if vim.bo[session.source].endofline then source = source .. "\n" end
    set_status("Reading native program…")
    request("inspect", {
        source = source,
        path = vim.api.nvim_buf_get_name(session.source),
        version = version,
    }, function(result)
        if current_version() ~= version then return end
        session.program = result
        if #result.machines == 0 then return set_status("No state machines in this program") end
        if session.machine then
            for _, machine in ipairs(result.machines) do
                if machine.orbital == session.machine.orbital and machine.trait == session.machine.trait then
                    return select_machine(machine, version)
                end
            end
        end
        if #result.machines == 1 then select_machine(result.machines[1], version) else M.choose() end
    end)
end

function M.attach(url, instance)
    if not session then return notify("Open the inspector before attaching a runtime") end
    if type(url) ~= "string" or url == "" or type(instance) ~= "string" or instance == "" then
        return notify("Provide the trace URL and expected runtime instance explicitly")
    end
    if session.attachment then return notify("Detach the current runtime before attaching another") end
    local current = session
    current.attachment = { url = url, instance = instance }
    current.client.request("attach", { url = url, instance = instance }, function(_, err)
        if session ~= current then return end
        if err then
            current.attachment = nil
            if err.code ~= "PROCESS_STOPPED" then notify(err.code .. ": " .. err.message) end
        end
    end)
end

function M.detach()
    if not session then return end
    clear_runtime()
    session.attachment = nil
    request("detach", {}, function() set_status("Runtime observation detached") end)
end

function M.trace()
    if not session then return notify("Open the inspector to inspect its trace messages") end
    local text = vim.inspect({ attachment = session.attachment, observation = session.observation, messages = session.traceMessages })
    vim.cmd("belowright split")
    local buffer = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(0, buffer)
    vim.bo[buffer].buftype, vim.bo[buffer].bufhidden, vim.bo[buffer].filetype = "nofile", "wipe", "lua"
    vim.api.nvim_buf_set_lines(buffer, 0, -1, false, vim.split(text, "\n", { plain = true }))
    vim.bo[buffer].modifiable = false
    vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buffer })
end

local function follow_source()
    if not session or not session.selection or not session.layout then return end
    if vim.api.nvim_get_current_buf() ~= session.source or current_version() ~= session.program.version then return end
    local cursor = vim.api.nvim_win_get_cursor(0)
    local line = vim.api.nvim_buf_get_lines(session.source, cursor[1] - 1, cursor[1], false)[1]
    local version = current_version()
    local path = vim.api.nvim_buf_get_name(session.source)
    session.focusSequence = (session.focusSequence or 0) + 1
    local sequence = session.focusSequence
    request("focus", {
        path = path, line = cursor[1], column = vim.str_utfindex(line, cursor[2]) + 1, version = version,
    }, function(result)
        if current_version() ~= version or session.focusSequence ~= sequence
            or result.version ~= version or result.path ~= path then return end
        local focus = result.focus
        if focus.ambiguous then
            return set_status("Cursor scope has multiple traits; press t to choose a trait")
        end
        if result.graph then
            session.machine = { orbital = result.orbital, trait = result.trait }
            return render_selection(result, version)
        end
        session.selection.focus = focus
        session.visual.selectedNodeId, session.visual.selectedEdgeId = nil, nil
        session.visual.selectedNodeIds, session.visual.selectedEdgeIds = focus.nodeIds, focus.edgeIds
        diagram.update(session.buffer, session.visual)
    end)
end

function M.close()
    if not session then return end
    local old = session
    session = nil
    old.client.stop()
    vim.api.nvim_del_augroup_by_id(old.group)
    if vim.api.nvim_buf_is_valid(old.source) then vim.api.nvim_buf_clear_namespace(old.source, source_namespace, 0, -1) end
    if vim.api.nvim_buf_is_valid(old.buffer) then vim.api.nvim_buf_delete(old.buffer, { force = true }) end
end

function M.open()
    if session then
        if vim.api.nvim_win_is_valid(session.window) then vim.api.nvim_set_current_win(session.window) end
        return
    end
    local source = vim.api.nvim_get_current_buf()
    local path = vim.api.nvim_buf_get_name(source)
    if path == "" then return notify("Name this buffer before opening the inspector") end
    local options = config.options.inspector
    local command = options.command
    if not command then
        if not options.program then return notify("Set inspector.program to the Orb inspector .lolo program") end
        command = { config.options.cmd or "orb", "run", vim.fn.expand(options.program) }
    end
    local client, err = require("almadar.inspector_client").start(command, vim.fs.dirname(path), notify, receive_notification)
    if not client then return notify(err) end
    local source_window = vim.api.nvim_get_current_win()
    vim.cmd("botright " .. options.width .. "vsplit")
    local buffer = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_win_set_buf(0, buffer)
    vim.bo[buffer].buftype = "nofile"
    vim.bo[buffer].bufhidden = "wipe"
    vim.bo[buffer].swapfile = false
    vim.bo[buffer].filetype = "orb-diagram"
    vim.wo.wrap = false
    vim.wo.number = false
    vim.wo.relativenumber = false
    vim.wo.signcolumn = "no"
    vim.wo.cursorline = true
    session = {
        client = client, source = source, source_window = source_window, buffer = buffer,
        window = vim.api.nvim_get_current_win(),
        traceMessages = {},
        group = vim.api.nvim_create_augroup("AlmadarInspector", { clear = true }),
    }
    local maps = { ["<CR>"] = M.jump, ["K"] = M.details, ["t"] = M.choose, ["r"] = M.refresh, ["q"] = M.close }
    for key, action in pairs(maps) do vim.keymap.set("n", key, action, { buffer = buffer, silent = true }) end
    vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "BufWritePost" }, {
        group = session.group, buffer = source, callback = M.refresh,
    })
    vim.api.nvim_create_autocmd("CursorMoved", { group = session.group, buffer = source, callback = follow_source })
    vim.api.nvim_create_autocmd("BufWipeout", { group = session.group, buffer = buffer, callback = M.close })
    vim.api.nvim_create_autocmd("VimLeavePre", { group = session.group, callback = M.close })
    M.refresh()
end

return M
