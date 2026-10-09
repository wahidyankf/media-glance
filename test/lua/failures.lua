local root = vim.fn.tempname() .. '-protocol-unit'
vim.fn.mkdir(root, 'p')
vim.fn.writefile({ '# fallback' }, root .. '/README.md')
root = vim.uv.fs_realpath(root)
local record = {
  type = 'ready',
  version = 1,
  instance = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  root = root,
  port = 57300,
  url = 'http://127.0.0.1:57300/v/' .. string.rep('a', 64) .. '/',
  ownerPid = vim.fn.getpid(),
  pid = 12,
}
local originals = {
  system = vim.system,
  jobstart = vim.fn.jobstart,
  chansend = vim.fn.chansend,
  chanclose = vim.fn.chanclose,
  notify = vim.notify,
  open = vim.ui.open,
  select = vim.ui.select,
  defer_fn = vim.defer_fn,
  schedule = vim.schedule,
  stdpath = vim.fn.stdpath,
  executable = vim.fn.executable,
  install = require('media-glance.install').install,
}
local jobs, notices, queued, timers, lists, browser_urls = {}, {}, {}, {}, {}, {}
local next_job, selected, system_stage = 200, 1, nil
local function flush()
  while #queued > 0 do
    table.remove(queued, 1)()
  end
end
vim.schedule = function(callback)
  queued[#queued + 1] = callback
end
vim.defer_fn = function(callback)
  timers[#timers + 1] = callback
end
vim.notify = function(message)
  notices[#notices + 1] = message
end
vim.fn.chansend = function()
  error 'send failed'
end
vim.fn.chanclose = function()
  error 'close failed'
end
vim.fn.jobstart = function(arguments, options)
  next_job = next_job + 1
  jobs[next_job] = { arguments = arguments, options = options }
  return next_job
end
vim.ui.open = function(url)
  browser_urls[#browser_urls + 1] = url
  return nil, 'browser missing'
end
vim.ui.select = function(items, options, callback)
  for _, item in ipairs(items) do
    assert(options.format_item(item):find 'owner', 'picker item lacks owner')
  end
  callback(selected and items[selected] or nil)
end
vim.system = function(args, _, callback)
  if system_stage == 'throw-list' or (args[2] == 'stop' and system_stage == 'throw-stop') then
    error 'launch failed'
  end
  local payload = args[2] == 'list' and { type = 'list', version = 1, servers = lists }
    or { type = 'stopped', version = 99 }
  callback({ code = 0, stdout = vim.json.encode(payload), stderr = '' })
  return {}
end
local function fresh(configuration)
  package.loaded['media-glance'] = nil
  local media = require 'media-glance'
  media.setup(configuration or {
    binary = '/bin/sh',
    root = function()
      return root
    end,
  })
  return media
end
local function ready(job, value)
  jobs[job].options.on_stdout(job, { vim.json.encode(value or record), '' })
end
local function run()
  local media = fresh({
    root = function()
      error 'root callback failed'
    end,
    binary = '/bin/sh',
  })
  media.open()
  assert(notices[#notices]:find 'callback failed', 'root callback error escaped')
  media = fresh({
    root = function()
      return root .. '/missing'
    end,
    binary = '/bin/sh',
  })
  media.open()
  assert(notices[#notices]:find 'unavailable', 'missing workspace accepted')
  media = fresh()
  media.open()
  local first = next_job
  ready(first)
  media.shutdown()
  media.open()
  flush()
  assert(#browser_urls == 0, 'shutdown before scheduled readiness opened browser')
  assert(notices[#notices]:find 'stopping', 'stopping state did not refuse open')
  jobs[first].options.on_exit(first - 1, 0)
  flush()
  jobs[first].options.on_exit(first, 0)
  flush()
  media.open()
  local second = next_job
  local wrong = vim.deepcopy(record)
  wrong.ownerPid = wrong.ownerPid + 1
  ready(second, wrong)
  flush()
  assert(notices[#notices]:find 'ownership pipe', 'owner mismatch did not shut down')
  jobs[second].options.on_exit(second, 0)
  flush()
  media.open()
  local third = next_job
  jobs[third].options.on_stderr(third, { '', 'fault detail' })
  jobs[third].options.on_exit(third, 2)
  flush()
  assert(notices[#notices]:find 'fault detail', 'stderr context was lost')
  media.open()
  local fourth = next_job
  ready(fourth)
  ready(fourth)
  flush()
  assert(#browser_urls == 1 and notices[#notices]:find 'port', 'duplicate readiness accepted twice')
  timers[#timers]()
  lists = { record }
  system_stage = 'throw-list'
  media.list()
  assert(notices[#notices]:find 'could not list', 'list spawn failure escaped')
  system_stage = 'throw-stop'
  media.close()
  flush()
  assert(notices[#notices]:find 'could not stop', 'stop spawn failure escaped')
  system_stage = nil
  media.close()
  flush()
  assert(notices[#notices]:find 'could not stop', 'invalid stop response accepted')
  local another, last = vim.deepcopy(record), vim.deepcopy(record)
  another.port, another.url, another.instance =
    57302, 'http://127.0.0.1:57302/v/' .. string.rep('b', 64) .. '/', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
  last.port, last.url, last.instance =
    57301, 'http://127.0.0.1:57301/v/' .. string.rep('c', 64) .. '/', 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  lists = { another, last, record }
  media.list()
  flush()
  assert(browser_urls[#browser_urls]:find('file=README.md', 1, true), 'unsaved buffer missed README fallback')
  vim.fn.delete(root .. '/README.md')
  media.list()
  flush()
  assert(not browser_urls[#browser_urls]:find '?', 'chooser retained stale file')
  vim.bo.filetype = 'TelescopePrompt'
  local closed_prompt
  package.loaded['telescope.actions'] = {
    close = function(buffer)
      closed_prompt = buffer
    end,
  }
  selected = nil
  media.list()
  flush()
  local mapping = vim.fn.maparg('<Esc>', 'i', false, true)
  mapping.callback()
  assert(closed_prompt == vim.api.nvim_get_current_buf(), 'Escape canceled a different buffer')
  vim.bo.filetype = ''
  media = fresh({ binary = '/nonexistent' })
  media.list()
  assert(notices[#notices]:find 'unavailable', 'missing binary reached list')
  media = fresh({ cache_dir = root })
  local cached_binary
  vim.fn.executable = function(path)
    cached_binary = path
    return originals.executable(path)
  end
  media.open()
  vim.fn.executable = originals.executable
  assert(cached_binary == root .. '/v0.1.3/media-glance', 'runtime looked up a different release cache')
  assert(notices[#notices]:find 'unavailable', 'missing cached release started a build')
  media = fresh()
  require('media-glance.install').install = function(cache)
    assert(cache:find('media-glance', 1, true))
    return nil, 'download failed'
  end
  local path, failure = media.install()
  assert(not path and failure and notices[#notices]:find 'could not install', 'install failure not surfaced')
  require('media-glance.install').install = function()
    return '/verified/binary'
  end
  path, failure = media.install()
  assert(path == '/verified/binary' and not failure, 'install success not returned')
  vim.fn.stdpath = function()
    return { root }
  end
  local installed, install_error = pcall(media.install)
  assert(
    not installed and tostring(install_error):find('stdpath(cache) must return a string', 1, true),
    'invalid cache host path did not report its violated invariant'
  )
  media = fresh()
  local listed, list_error = pcall(media.list)
  assert(
    not listed and tostring(list_error):find('stdpath(state) must return a string', 1, true),
    'invalid state host path did not report its violated invariant'
  )
  local configured_state
  local list_system = vim.system
  vim.system = function(arguments, options, callback)
    configured_state = arguments[4]
    return list_system(arguments, options, callback)
  end
  media = fresh({ binary = '/bin/sh', state_dir = root .. '/configured-state' })
  media.list()
  flush()
  assert(configured_state == root .. '/configured-state', 'configured state path was replaced by a host default')
  vim.system = list_system
  vim.fn.stdpath = originals.stdpath
  print 'media-glance failure scenarios: OK'
end
local ok, failure = xpcall(run, debug.traceback)
vim.system, vim.fn.jobstart, vim.fn.chansend, vim.fn.chanclose =
  originals.system, originals.jobstart, originals.chansend, originals.chanclose
vim.notify, vim.ui.open, vim.ui.select, vim.defer_fn, vim.schedule =
  originals.notify, originals.open, originals.select, originals.defer_fn, originals.schedule
require('media-glance.install').install = originals.install
vim.fn.stdpath = originals.stdpath
vim.fn.executable = originals.executable
package.loaded['telescope.actions'] = nil
vim.bo.filetype = ''
vim.fn.delete(root, 'rf')
assert(ok, failure)
