local source = debug.getinfo(1, "S").source:gsub("^@", "")
local tests = vim.fs.dirname(vim.fs.normalize(vim.fn.fnamemodify(source, ":p")))
vim.opt.runtimepath:append(vim.fs.dirname(tests))
local transport = require("almadar.inspector_client")
local command = { "python3", tests .. "/fixtures/inspector_transport.py" }
local clients = {}

local function equal(actual, expected)
    assert(vim.deep_equal(actual, expected), vim.inspect(actual) .. " ~= " .. vim.inspect(expected))
end

local function wait_for(predicate, description)
    assert(vim.wait(5000, predicate, 5), "Timed out: " .. description)
end

local function start()
    local errors, notifications = {}, {}
    local client, failure = transport.start(command, tests, function(error)
        errors[#errors + 1] = error
    end, function(method, params)
        notifications[#notifications + 1] = { method = method, params = params }
    end)
    assert(client, failure)
    clients[#clients + 1] = client
    return client, errors, notifications
end

local function collect(target, name)
    return function(result, error)
        target[#target + 1] = { name = name, result = result, error = error }
    end
end

local ok, failure = xpcall(function()
    local client, errors, notifications = start()
    local responses = {}
    for index = 1, 3 do
        equal(client.request("sequential", { index = index }, collect(responses, index)), index)
    end
    wait_for(function() return #responses == 3 end, "sequential requests")
    for index = 1, 3 do
        equal(responses[index], { name = index, result = { index = index } })
    end
    equal(errors, {})

    client.request("fragmented", {}, collect(responses, "Unicode"))
    wait_for(function() return #responses == 4 end, "fragmented Unicode response")
    equal(responses[4], { name = "Unicode", result = "休憩 café 🌿" })
    equal(errors, {})

    client.request("notify", {}, collect(responses, "subscription"))
    wait_for(function() return #responses == 5 end, "notifications before request response")
    equal(notifications, {
        { method = "execution/trace", params = { state = "休憩", sequence = 1 } },
        { method = "execution/trace", params = { state = "running", sequence = 2 } },
    })
    equal(responses[5], { name = "subscription", result = { subscribed = true } })
    equal(errors, {})

    for _, method in ipairs({ "malformed", "wrong_shape" }) do
        local malformed = {}
        client.request(method, {}, collect(malformed, "invalid"))
        client.request("echo", { recovered = method }, collect(malformed, "recovered"))
        wait_for(function() return #malformed == 2 end, "invalid response recovery: " .. method)
        equal(malformed[1].error.code, "INVALID_RESPONSE")
        equal(malformed[1].result, nil)
        equal(malformed[2], { name = "recovered", result = { recovered = method } })
    end
    equal(#errors, 2)
    assert(errors[1]:find("{broken response", 1, true))
    assert(errors[2]:find("missing ID", 1, true))
    client.stop()

    local exiting, exit_errors = start()
    local exited = {}
    exiting.request("exit", {}, collect(exited, "inflight"))
    exiting.request("echo", {}, collect(exited, "queued"))
    wait_for(function() return #exited == 2 end, "process exit fails all pending requests")
    local names = {}
    for _, response in ipairs(exited) do
        names[response.name] = true
        equal(response.error.code, "PROCESS_EXIT")
        assert(response.error.message:find("status 7", 1, true))
        assert(response.error.message:find("incomplete final response", 1, true))
    end
    equal(names, { inflight = true, queued = true })
    wait_for(function() return #exit_errors == 1 end, "exit diagnostic")
    local closed = {}
    exiting.request("echo", {}, collect(closed, "closed"))
    equal(closed[1].error.code, "PROCESS_CLOSED")

    local stopping, stop_errors = start()
    local stopped = {}
    stopping.request("wait", {}, collect(stopped, "inflight"))
    stopping.request("echo", {}, collect(stopped, "queued"))
    stopping.stop()
    wait_for(function() return #stopped == 2 end, "explicit stop fails all pending requests")
    for _, response in ipairs(stopped) do equal(response.error.code, "PROCESS_STOPPED") end
    stopping.stop()
    vim.wait(50, function() return false end)
    equal(#stopped, 2)
    equal(stop_errors, {})
    local after_stop = {}
    stopping.request("echo", {}, collect(after_stop, "closed"))
    equal(after_stop[1].error.code, "PROCESS_CLOSED")
end, debug.traceback)

for _, client in ipairs(clients) do client.stop() end
assert(ok, failure)
print("inspector_client: real process sequencing, UTF-8 fragments, trace notifications, malformed replies, exit and stop passed")
