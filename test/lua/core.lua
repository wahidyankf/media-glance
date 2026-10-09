vim.opt.rtp:prepend(vim.fn.getcwd())
local root = vim.fn.tempname() .. ' media fixture'
vim.fn.mkdir(root, 'p')
root = vim.uv.fs_realpath(root)
vim.fn.writefile({ '# fixture' }, root .. '/README.md')
vim.fn.writefile({ '# active' }, root .. '/active #1.md')
vim.fn.mkdir(root .. '/nested', 'p')
vim.fn.writefile({ '# second focused file' }, root .. '/nested/focused #2.md')
local original_cwd = vim.fn.getcwd(-1, -1)
local originals = {
  system = vim.system,
  defer_fn = vim.defer_fn,
  select = vim.ui.select,
  open = vim.ui.open,
  notify = vim.notify,
  jobstart = vim.fn.jobstart,
  chansend = vim.fn.chansend,
  chanclose = vim.fn.chanclose,
}
local commands, browsers, notices, jobs, sent, closed = {}, {}, {}, {}, {}, {}
local locator_ready = true
local fail_start = false
local fail_list = false
local timers = {}
local next_job = 100
local chosen = nil
local picker_items
local servers = {}
local record = {
  type = 'ready',
  version = 1,
  instance = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  root = root,
  port = 57300,
  url = 'http://127.0.0.1:57300/v/' .. string.rep('a', 64) .. '/',
  ownerPid = vim.fn.getpid(),
  pid = 12345,
}

local function cleanup()
  if package.loaded['media-glance'] then
    require('media-glance').shutdown()
  end
  vim.system, vim.ui.select, vim.ui.open, vim.notify =
    originals.system, originals.select, originals.open, originals.notify
  vim.fn.jobstart, vim.fn.chansend, vim.fn.chanclose = originals.jobstart, originals.chansend, originals.chanclose
  vim.defer_fn = originals.defer_fn
  vim.api.nvim_set_current_dir(original_cwd)
  vim.fn.delete(root, 'rf')
end
local function expect(value, message)
  assert(value, message)
end
local function settle()
  vim.wait(20, function()
    return false
  end, 1)
end
local function run()
  vim.system = function(args, _, callback)
    table.insert(commands, args)
    local payload
    if args[2] == 'list' then
      expect(type(args[4]) == 'string', 'list state directory was not resolved')
      payload = { type = 'list', version = 1, servers = servers }
    elseif args[2] == 'stop' then
      payload = { type = 'stopped', version = 1, instance = args[6] }
    else
      error('unexpected system command: ' .. vim.inspect(args))
    end
    local result = {
      code = args[2] == 'list' and fail_list and 1 or 0,
      stdout = vim.json.encode(payload),
      stderr = 'fixture failure',
    }
    if callback then
      callback(result)
    end
    return {
      wait = function()
        return result
      end,
    }
  end
  vim.defer_fn = function(callback, timeout)
    timers[#timers + 1] = { callback = callback, timeout = timeout }
  end
  vim.notify = function(message)
    table.insert(notices, message)
  end
  vim.ui.open = function(url)
    table.insert(browsers, url)
    return {}
  end
  vim.ui.select = function(items, _, callback)
    picker_items = items
    callback(chosen and items[chosen] or nil)
  end
  vim.fn.jobstart = function(args, options)
    if fail_start then
      error 'fixture cannot execute binary'
    end
    next_job = next_job + 1
    jobs[next_job] = { args = args, options = options }
    return next_job
  end
  vim.fn.chansend = function(job, value)
    table.insert(sent, { job, value })
    return #value
  end
  vim.fn.chanclose = function(job, stream)
    table.insert(closed, { job, stream })
    return 1
  end
  vim.api.nvim_set_current_dir(root)
  vim.cmd.edit(vim.fn.fnameescape(root .. '/active #1.md'))
  local media = require 'media-glance'
  media.setup({ binary = locator_ready and '/bin/sh' or '/missing-build' })
  locator_ready = false
  media.setup({ binary = '/missing-build' })
  media.open()
  expect(next_job == 100 and #browsers == 0, 'missing build launched a process or browser')
  expect(notices[#notices]:find('MediaGlanceInstall', 1, true), 'missing build did not explain explicit build command')
  locator_ready = true
  media.setup({ binary = '/bin/sh' })
  media.open()
  local job = jobs[101]
  expect(job ~= nil, 'open did not start the server')
  expect(job.args[1] == '/bin/sh' and job.args[2] == 'serve', 'runtime did not use cached binary directly')
  expect(job.args[4] == root, 'server root did not use global workspace cwd')
  expect(job.args[10] == root .. '/active #1.md', 'initial file lost path spaces or characters')
  expect(#job.args == 10, 'private tool-root flag leaked into plugin')
  expect(#browsers == 0, 'browser opened before readiness')
  media.open()
  expect(next_job == 101, 'repeat while starting spawned another server')
  local encoded = vim.json.encode(record)
  job.options.on_stdout(101, { encoded:sub(1, 17) })
  job.options.on_stdout(101, { encoded:sub(18), '' })
  settle()
  expect(#browsers == 1 and browsers[1]:find 'active%%20%%231.md', 'ready did not open encoded active path')
  vim.cmd.edit(vim.fn.fnameescape(root .. '/nested/focused #2.md'))
  vim.api.nvim_set_current_dir(original_cwd)
  media.open()
  expect(next_job == 101 and #browsers == 2, 'repeat open changed server after cwd change')
  expect(
    browsers[2]:find('file=nested%2Ffocused%20%232.md', 1, true),
    'repeat open retained the previously focused file'
  )
  local foreign = vim.deepcopy(record)
  foreign.instance, foreign.ownerPid, foreign.port, foreign.url =
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 99999, 57301, 'http://127.0.0.1:57301/v/' .. string.rep('b', 64) .. '/'
  servers = { foreign, record }
  chosen = nil
  media.close()
  settle()
  expect(picker_items[1].instance == record.instance, 'close picker did not put current owner first')
  expect(commands[#commands][2] == 'list', 'Escape stopped a server')
  chosen = 2
  media.close()
  settle()
  expect(
    commands[#commands][2] == 'stop' and commands[#commands][6] == foreign.instance,
    'selected close stopped the wrong instance'
  )
  chosen = 1
  media.list()
  settle()
  expect(#browsers == 3 and browsers[3]:find '57300', 'list selection did not open selected server')
  expect(browsers[3] == browsers[2], 'list selection did not open the newly focused saved file')
  servers =
    { { type = 'ready', version = 1, instance = 'bad', port = 3000, url = 'https://example.invalid', root = root } }
  chosen = 1
  media.list()
  settle()
  expect(#browsers == 3, 'invalid external server record reached browser')
  media.setup({ binary = locator_ready and '/bin/sh' or '/missing-build' })
  expect(
    #vim.api.nvim_get_autocmds({ group = 'MediaGlance', event = 'VimLeavePre' }) == 1,
    'repeated setup duplicated cleanup'
  )
  media.shutdown()
  expect(sent[#sent][1] == 101 and sent[#sent][2] == 'stop\n', 'shutdown did not signal owned pipe')
  expect(closed[#closed][1] == 101 and closed[#closed][2] == 'stdin', 'shutdown did not close ownership pipe')
  job.options.on_exit(101, 0)
  settle()
  fail_start = true
  media.open()
  expect(
    next_job == 101 and notices[#notices]:find('could not start', 1, true),
    'job launch exception escaped its boundary'
  )
  fail_start = false
  vim.api.nvim_set_current_dir(root)
  media.open()
  expect(next_job == 102 and timers[#timers].timeout == 30000, 'startup retry or timeout bound changed')
  local retry = jobs[102]
  retry.options.on_stdout(102, { 'not valid JSON', '' })
  timers[#timers].callback()
  expect(#browsers == 3 and sent[#sent][1] == 102, 'readiness timeout opened browser or failed to close ownership pipe')
  retry.options.on_exit(102, 0)
  settle()
  media.open()
  local early_exit = jobs[103]
  early_exit.options.on_exit(103, 0)
  settle()
  expect(notices[#notices]:find('server exited', 1, true), 'exit without readiness was silently accepted')
  fail_list = true
  local previous_picker = picker_items
  media.list()
  settle()
  expect(
    picker_items == previous_picker and notices[#notices]:find('could not list', 1, true),
    'list failure reached a picker'
  )
  fail_list = false
  servers = {}
  media.list()
  settle()
  expect(notices[#notices]:find('no running servers', 1, true), 'empty list was not explained')
  print 'media-glance core scenarios: OK'
end
local ok, failure = xpcall(run, debug.traceback)
cleanup()
if not ok then
  error(failure)
end
