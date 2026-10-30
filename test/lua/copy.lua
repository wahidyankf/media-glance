vim.opt.rtp:prepend(vim.fn.getcwd())
local root = vim.fn.tempname() .. '-copy-fixture'
vim.fn.mkdir(root, 'p')
root = vim.uv.fs_realpath(root)
vim.fn.writefile({ '# fixture' }, root .. '/README.md')
vim.fn.writefile({ '# active' }, root .. '/active #1.md')
local original_cwd = vim.fn.getcwd(-1, -1)
local originals = {
  system = vim.system,
  select = vim.ui.select,
  open = vim.ui.open,
  notify = vim.notify,
  jobstart = vim.fn.jobstart,
  chansend = vim.fn.chansend,
  chanclose = vim.fn.chanclose,
  setreg = vim.fn.setreg,
}
local commands, browsers, notices, jobs, sent, closed, setregs = {}, {}, {}, {}, {}, {}, {}
local fail_clipboard = false
local chosen = 1
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
local servers = { record }

local function cleanup()
  vim.system, vim.ui.select, vim.ui.open, vim.notify =
    originals.system, originals.select, originals.open, originals.notify
  vim.fn.jobstart, vim.fn.chansend, vim.fn.chanclose, vim.fn.setreg =
    originals.jobstart, originals.chansend, originals.chanclose, originals.setreg
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
    expect(args[2] == 'list', 'copy must only discover servers, never start or stop one')
    local result =
      { code = 0, stdout = vim.json.encode({ type = 'list', version = 1, servers = servers }), stderr = '' }
    if callback then
      callback(result)
    end
    return {
      wait = function()
        return result
      end,
    }
  end
  vim.notify = function(message, level)
    table.insert(notices, { message = message, level = level })
  end
  vim.ui.open = function(url)
    table.insert(browsers, url)
    return {}
  end
  vim.ui.select = function(items, _, callback)
    expect(#items == 1, 'copy picker must list the same running servers as list/close')
    callback(chosen and items[chosen] or nil)
  end
  vim.fn.jobstart = function()
    error 'copy must never start a server'
  end
  vim.fn.chansend = function(job, value)
    table.insert(sent, { job, value })
    return #value
  end
  vim.fn.chanclose = function(job, stream)
    table.insert(closed, { job, stream })
    return 1
  end
  vim.fn.setreg = function(name, value)
    if fail_clipboard then
      error 'clipboard unavailable'
    end
    table.insert(setregs, { name, value })
  end
  vim.api.nvim_set_current_dir(root)
  vim.cmd.edit(vim.fn.fnameescape(root .. '/active #1.md'))
  local media = require 'media-glance'
  media.setup({ binary = '/bin/sh' })
  expect(vim.fn.exists ':MediaGlanceCopy' == 2, 'MediaGlanceCopy command missing')
  expect(vim.fn.exists ':MediaCopy' == 2, 'MediaCopy command missing')
  chosen = 1
  media.copy()
  settle()
  expect(#setregs == 1 and setregs[1][1] == '+', 'copy did not yank to the system clipboard')
  local copied = setregs[1][2]
  expect(copied:find('file=active%%20%%231.md', 1, false), 'copy missed the focused file query')
  expect(
    #notices == 1 and notices[1].message == copied and notices[1].level == vim.log.levels.INFO,
    'copy did not notify the URL at INFO level'
  )
  expect(#browsers == 0, 'copy opened a browser')
  media.list()
  settle()
  expect(#browsers == 1, 'list selection did not open the selected server')
  expect(browsers[1] == copied, 'copy URL differs from the URL open would open')
  fail_clipboard = true
  media.copy()
  settle()
  expect(#setregs == 1, 'failed clipboard write must not reach a register')
  expect(
    #notices == 2 and notices[2].message == copied and notices[2].level == vim.log.levels.INFO,
    'clipboard fallback did not notify the URL text at INFO level'
  )
  for _, notice in ipairs(notices) do
    expect(notice.level ~= vim.log.levels.ERROR, 'copy reported an ordinary outcome as an error')
  end
  fail_clipboard = false
  chosen = nil
  media.copy()
  settle()
  expect(#setregs == 1 and #notices == 2, 'cancelled copy yanked or notified')
  for _, args in ipairs(commands) do
    expect(args[2] == 'list', 'copy touched server lifecycle')
  end
  expect(next(jobs) == nil and #sent == 0 and #closed == 0, 'copy touched server lifecycle')
  print 'media-glance copy scenarios: OK'
end
local ok, failure = xpcall(run, debug.traceback)
cleanup()
if not ok then
  error(failure)
end
