local M = {}

function M.start(command, cwd, on_error, on_notification)
    local client = { pending = {}, queue = {}, sequence = 0, fragment = "", closed = false }
    local function pump()
        if client.closed or client.inflight or #client.queue == 0 then return end
        local request = table.remove(client.queue, 1)
        client.inflight = request.id
        vim.fn.chansend(client.job, vim.json.encode(request.message) .. "\n")
    end
    local function receive(line)
        local ok, message = pcall(vim.json.decode, line, { luanil = { object = true } })
        if ok and type(message) == "table" and message.id == nil and type(message.method) == "string" then
            if on_notification then on_notification(message.method, message.params) end
            return
        end
        if not ok or type(message) ~= "table" or message.id == nil then
            on_error("Invalid native inspector response: " .. line)
            local callback = client.inflight and client.pending[client.inflight]
            if client.inflight then client.pending[client.inflight] = nil end
            client.inflight = nil
            if callback then callback(nil, { code = "INVALID_RESPONSE", message = line }) end
            pump()
            return
        end
        local callback = client.pending[message.id]
        client.pending[message.id] = nil
        if client.inflight == message.id then client.inflight = nil end
        if callback then callback(message.result, message.error) end
        pump()
    end
    client.job = vim.fn.jobstart(command, {
        cwd = cwd,
        stdout_buffered = false,
        on_stdout = function(_, data)
            vim.schedule(function()
                if client.closed then return end
                for index, part in ipairs(data) do
                    client.fragment = client.fragment .. part
                    if index < #data then
                        receive(client.fragment)
                        client.fragment = ""
                    end
                end
            end)
        end,
        on_stderr = function(_, data)
            local text = table.concat(data, "\n")
            if text ~= "" then vim.schedule(function() on_error(text) end) end
        end,
        on_exit = function(_, code)
            vim.schedule(function()
                if client.closed then return end
                client.closed = true
                local failure = { code = "PROCESS_EXIT", message = "Native inspector exited with status " .. code }
                if client.fragment ~= "" then failure.message = failure.message .. "\n" .. client.fragment end
                local pending = client.pending
                client.pending = {}
                for _, callback in pairs(pending) do callback(nil, failure) end
                if code ~= 0 then on_error(failure.message) end
            end)
        end,
    })
    if client.job <= 0 then return nil, "Could not start the native inspector" end
    function client.request(method, params, callback)
        if client.closed then
            callback(nil, { code = "PROCESS_CLOSED", message = "Native inspector is closed" })
            return
        end
        client.sequence = client.sequence + 1
        local id = client.sequence
        client.pending[id] = callback
        table.insert(client.queue, { id = id, message = { id = id, method = method, params = params } })
        pump()
        return id
    end
    function client.stop()
        if client.closed then return end
        client.closed = true
        vim.fn.jobstop(client.job)
        local pending = client.pending
        client.pending = {}
        client.queue = {}
        client.inflight = nil
        for _, callback in pairs(pending) do
            callback(nil, { code = "PROCESS_STOPPED", message = "Native inspector stopped" })
        end
    end
    return client
end

return M
