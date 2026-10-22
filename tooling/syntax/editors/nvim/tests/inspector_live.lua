local test = debug.getinfo(1, "S").source:gsub("^@", "")
vim.opt.runtimepath:prepend(vim.fs.dirname(vim.fs.dirname(vim.fn.fnamemodify(test, ":p"))))
local root = assert(vim.env.ALMADAR_WORKSPACE, "ALMADAR_WORKSPACE is required")
local orb = assert(vim.env.ORB_BIN, "ORB_BIN is required")
local origin = "http://127.0.0.1:3030"
local app_path = root .. "/packages/almadar-behaviors/scripts/fixtures/orb-inspector-live.lolo"
local inspector_path = root .. "/packages/almadar-behaviors/behaviors/lolo/editor-plugins/atoms/orb-inspector.lolo"
local source_path = root .. "/packages/almadar-std/behaviors/lolo/flow/atoms/std-retry.lolo"
local errors, app_errors = {}, {}
vim.notify = function(message, level)
    if level == vim.log.levels.ERROR then errors[#errors + 1] = message end
end
local function http(path, payload)
    local args = { "curl", "--silent", "--show-error", "--fail-with-body", "--max-time", "5", origin .. path }
    if payload then
        vim.list_extend(args, { "--header", "Content-Type: application/json", "--data", vim.json.encode(payload) })
    end
    local response = vim.system(args, { text = true }):wait()
    assert(response.code == 0, response.stderr .. response.stdout)
    return vim.json.decode(response.stdout)
end
local preflight = vim.system({ "curl", "--silent", "--connect-timeout", "0.2", "--max-time", "0.3", origin .. "/api/health" }):wait()
assert(preflight.code ~= 0, "Port 3030 is occupied; run this native integration check serially")
local app = vim.fn.jobstart({ orb, "run", app_path }, {
    cwd = root,
    on_stderr = function(_, data)
        for _, line in ipairs(data) do
            if line ~= "" then
                app_errors[#app_errors + 1] = line
                print("native app: " .. line)
            end
        end
    end,
})
assert(app > 0, "native app did not launch")
local inspector = require("almadar.inspector")
local function wait_for(predicate, description)
    assert(vim.wait(30000, function() return #errors > 0 or predicate() end, 10), description .. "\n" .. table.concat(app_errors, "\n"))
    assert(#errors == 0, table.concat(errors, "\n"))
end
local function count_highlights(group)
    local count = 0
    for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(inspector.status().buffer, require("almadar.diagram").namespace, 0, -1, { details = true })) do
        if mark[4].hl_group == group then count = count + 1 end
    end
    return count
end
local ok, failure = xpcall(function()
    wait_for(function()
        local ready, health = pcall(http, "/api/health")
        return ready and health.status == "healthy"
    end, "native application health")
    print("PASS native application boot")
    local stream = vim.system({ "curl", "--silent", "--no-buffer", "--max-time", "1", origin .. "/api/inspector/trace" }, { text = true }):wait()
    local instance
    for _, line in ipairs(vim.split(stream.stdout, "\n", { plain = true })) do
        local data = line:match("^data:%s*(.*)$")
        if data then
            local envelope = vim.json.decode(data)
            if envelope.type == "trace-attached" then instance = envelope.instance end
        end
    end
    assert(type(instance) == "string" and instance ~= "", "native SSE handshake did not identify its instance")
    require("almadar.config").setup({ inspector = { command = { orb, "run", inspector_path } } })
    vim.cmd.edit(vim.fn.fnameescape(source_path))
    vim.ui.select = function(items, _, callback)
        for _, item in ipairs(items) do
            if item.orbital == "RetryOrbital" and item.trait == "Retry" then return callback(item) end
        end
        error("native Retry state machine missing")
    end
    inspector.open()
    wait_for(function() return inspector.status().layout ~= nil end, "native Neovim diagram")
    inspector.attach(origin, "/api/inspector/trace", instance)
    wait_for(function()
        local status = inspector.status()
        if status.observation then return true end
        for _, message in ipairs(status.traceMessages) do
            if message.method == "trace" and message.params.type == "trace-disconnected" then return true end
        end
        return false
    end, "native trace attachment projection")
    assert(inspector.status().observation, "native observation disconnected before its initial projection")
    assert(#inspector.status().observation.activeNodeIds == 0, "initial state must remain unobserved")
    assert(vim.wo[inspector.status().window].winbar:find("unobserved", 1, true))
    assert(count_highlights("AlmadarDiagramActive") == 0)
    print("PASS actual SSE → native inspector → Neovim attachment, unobserved initial state")
    for _, step in ipairs({
        { event = "START", payload = { key = "inspector-probe" }, expected = "running", completed = true },
        { event = "FAILED", payload = { key = "different-key", error = "guard control" }, expected = "running", completed = false },
        { event = "FAILED", payload = { key = "inspector-probe", error = "retry control" }, expected = "backoff", completed = true },
        { event = "CANCEL", payload = vim.empty_dict(), expected = "idle", completed = true },
    }) do
        local sequence = inspector.status().observation.sequence
        local response = http("/api/orbitals/Work/events", {
            event = step.event, targetTrait = "WorkRetry", entityId = "inspector-retry", payload = step.payload,
        })
        assert(response.success, vim.inspect(response))
        wait_for(function()
            local observed = inspector.status().observation
            return observed and observed.sequence > sequence and vim.tbl_contains(observed.activeNodeIds, step.expected)
        end, "native observed " .. step.event .. " → " .. step.expected)
        local state = inspector.status()
        assert(state.observation.instance == instance)
        assert(state.observation.traitId == state.selection.machine.id)
        assert(count_highlights("AlmadarDiagramActive") > 0)
        assert((#state.observation.firedEdgeIds > 0) == step.completed)
        assert((count_highlights("AlmadarDiagramFired") > 0) == step.completed)
        assert(#state.observation.bindingIssues == 0)
        assert(vim.wo[state.window].winbar:find("source definition observations", 1, true))
        if not step.completed then
            local guarded
            for _, message in ipairs(state.traceMessages) do
                local dispatch = message.params.dispatch
                if message.method == "trace" and dispatch and dispatch.seq == state.observation.sequence then
                    for _, outcome in ipairs(dispatch.outcomes) do
                        if outcome.traitId == state.observation.frames[1].traitId and outcome.stateEntityId == "inspector-retry" then
                            guarded = outcome
                        end
                    end
                end
            end
            assert(guarded and not guarded.executed and #guarded.guardResults > 0)
            for _, guard in ipairs(guarded.guardResults) do assert(not guard.passed) end
        end
        print("PASS actual " .. step.event .. " → " .. step.expected .. (step.completed and " + completed edge highlight" or " + failed guard control, no completed edge"))
    end
    inspector.detach()
    assert(not inspector.status().observation and count_highlights("AlmadarDiagramActive") == 0)
    print("PASS native detach clears live overlays")
end, debug.traceback)
if not ok then
    local status = inspector.status()
    print(vim.inspect({ notifications = status.traceMessages, attachment = status.attachment, traitId = status.selection and status.selection.machine.id, version = status.version }))
end
inspector.close()
vim.fn.jobstop(app)
vim.fn.jobwait({ app }, 5000)
assert(ok, failure)
print("inspector live: real native application/SSE/source projection/process bridge/Neovim highlights passed")
