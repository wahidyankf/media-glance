local repository = vim.uv.fs_realpath(vim.fn.getcwd())
local binary = repository .. '/build/media-glance'
assert(vim.fn.executable(binary) == 1, 'run npm run build explicitly before Lua integration')
local fixture = vim.fn.tempname() .. '-media-glance-host'
local workspace, other, state = fixture .. '/workspace with spaces', fixture .. '/other', fixture .. '/state'
vim.fn.mkdir(workspace .. '/nested', 'p')
vim.fn.mkdir(other, 'p')
fixture = vim.uv.fs_realpath(fixture)
workspace, other, state = fixture .. '/workspace with spaces', fixture .. '/other', fixture .. '/state'
vim.fn.writefile({ '# initial' }, workspace .. '/first #1.md')
vim.fn.writefile({ '# focused' }, workspace .. '/nested/second #2.md')
vim.fn.writefile({ '# fallback' }, workspace .. '/README.md')
local hosts, channels, tracked = {}, {}, {}
local function execute(args)
  local result = vim.system(args, { text = true, timeout = 10000 }):wait(11000)
  assert(result.code == 0, 'fixture command failed: ' .. (result.stderr or ''))
  return result.stdout
end
local function rpc(index, code, arguments)
  return vim.rpcrequest(channels[index], 'nvim_exec_lua', code, arguments or {})
end
local function keys(index, input)
  vim.rpcnotify(channels[index], 'nvim_input', input)
end
local function wait(predicate, message, timeout)
  assert(vim.wait(timeout or 8000, predicate, 20), message)
end
local function list()
  local servers = vim.json.decode(execute({ binary, 'list', '--state-dir', state })).servers
  for _, server in ipairs(servers) do
    tracked[server.pid] = true
  end
  return servers
end
local function alive(pid)
  return vim.system({ 'kill', '-0', tostring(pid) }):wait(1000).code == 0
end
local init = fixture .. '/init.lua'
vim.fn.writefile({
  'vim.opt.rtp:prepend(' .. vim.inspect(repository) .. ')',
  'browser_urls = {}; picker = nil',
  'vim.ui.open = function(url) table.insert(browser_urls,url); return {} end',
  'vim.ui.select = function(items, options, callback)',
  '  local previous = vim.api.nvim_get_current_win()',
  "  local buffer = vim.api.nvim_create_buf(false,true); vim.bo[buffer].buftype = 'nofile'",
  '  local labels = {}; for _, item in ipairs(items) do labels[#labels+1] = options.format_item(item) end',
  '  vim.api.nvim_buf_set_lines(buffer,0,-1,false,labels)',
  "  local window = vim.api.nvim_open_win(buffer,true,{ relative='editor',row=1,col=1,width=60,height=#items,style='minimal' })",
  '  picker = { items = items, window = window }',
  '  local function select(cancel)',
  '    local selected = not cancel and items[vim.api.nvim_win_get_cursor(window)[1]] or nil',
  '    vim.api.nvim_win_close(window,true); vim.api.nvim_set_current_win(previous); picker = nil; callback(selected)',
  '  end',
  "  vim.keymap.set('n','<CR>',function() select(false) end,{buffer=buffer})",
  "  vim.keymap.set('n','<Esc>',function() select(true) end,{buffer=buffer})",
  'end',
  "local media = require 'media-glance'",
  'media.setup { binary = ' .. vim.inspect(binary) .. ', state_dir = ' .. vim.inspect(state) .. ' }',
  "vim.keymap.set('n','<BS>wvmo',media.open)",
  "vim.keymap.set('n','<BS>wvml',media.list)",
  "vim.keymap.set('n','<BS>wvmx',media.close)",
}, init)
local function start()
  local index = #hosts + 1
  local socket = fixture .. '/' .. index .. '.sock'
  local stderr = {}
  local job = vim.fn.jobstart(
    { vim.v.progpath, '--headless', '-u', init, '-i', 'NONE', '--listen', socket, workspace .. '/first #1.md' },
    {
      cwd = workspace,
      on_stderr = function(_, lines)
        for _, line in ipairs(lines) do
          if line ~= '' then
            stderr[#stderr + 1] = line
          end
        end
      end,
    }
  )
  assert(job > 0, 'isolated Neovim failed to launch')
  hosts[index] = { job = job, pid = vim.fn.jobpid(job), stderr = stderr }
  wait(function()
    return vim.uv.fs_stat(socket) ~= nil
  end, 'Neovim socket unavailable')
  channels[index] = vim.fn.sockconnect('pipe', socket, { rpc = true })
  assert(channels[index] > 0, 'RPC socket refused')
  assert(rpc(index, [[return vim.fn.exists(':MediaGlanceInstall') == 2]]), 'public installer command missing')
  return index
end
local function run()
  local one, two = start(), start()
  rpc(one, [[vim.cmd('lcd ' .. vim.fn.fnameescape(...))]], { other })
  keys(one, '<BS>wvmo')
  keys(two, '<BS>wvmo')
  wait(function()
    return #list() == 2
  end, 'multiple sessions did not start independent servers')
  wait(function()
    return #rpc(one, 'return browser_urls') == 1 and #rpc(two, 'return browser_urls') == 1
  end, 'ready servers did not open the focused file')
  local servers = list()
  assert(servers[1].root == workspace and servers[2].root == workspace, 'local cwd changed global workspace root')
  assert(servers[1].port ~= servers[2].port, 'multiple sessions reused one port')
  local first_url = rpc(one, 'return browser_urls[1]')
  assert(first_url:find('file=first%20%231.md', 1, true), 'initial focus was lost')
  assert(execute({ 'curl', '--fail', '--silent', first_url }):find 'html', 'ready URL is unavailable')
  rpc(one, 'vim.cmd.edit(vim.fn.fnameescape(...))', { workspace .. '/nested/second #2.md' })
  keys(one, '<BS>wvmo')
  wait(function()
    return #rpc(one, 'return browser_urls') == 2
  end, 'focused reopen did not reuse server')
  local focused_url = rpc(one, 'return browser_urls[2]')
  assert(focused_url:find('file=nested%2Fsecond%20%232.md', 1, true), 'reopen retained initial file')
  assert(focused_url:gsub('%?.*$', '') == first_url:gsub('%?.*$', ''), 'reopen changed instance')
  rpc(one, 'vim.api.nvim_set_current_dir(...)', { other })
  keys(one, '<BS>wvmo')
  wait(function()
    return #rpc(one, 'return browser_urls') == 3
  end, 'immutable-root reopen did not open')
  assert(rpc(one, 'return browser_urls[3]') == focused_url, 'cwd change replaced existing root')
  keys(one, '<BS>wvml')
  wait(function()
    return rpc(one, 'return picker ~= nil')
  end, 'list key did not open picker')
  keys(one, '<CR>')
  wait(function()
    return #rpc(one, 'return browser_urls') == 4
  end, 'list Enter did not open')
  assert(rpc(one, 'return browser_urls[4]') == focused_url, 'picker buffer replaced focused file')
  keys(one, '<BS>wvmx')
  wait(function()
    return rpc(one, 'return picker ~= nil')
  end, 'close key did not open picker')
  keys(one, '<Esc>')
  wait(function()
    return rpc(one, 'return picker == nil')
  end, 'Escape did not cancel')
  assert(#list() == 2, 'Escape stopped a server')
  keys(one, '<BS>wvmx')
  wait(function()
    return rpc(one, 'return picker ~= nil')
  end, 'close picker did not reopen')
  keys(one, 'j<CR>')
  wait(function()
    return #list() == 1
  end, 'Enter did not stop selected foreign server')
  assert(list()[1].ownerPid == hosts[one].pid, 'selected close stopped own server')
  keys(two, ':MediaGlanceOpen<CR>')
  wait(function()
    return #list() == 2
  end, 'stopped owner could not restart via public command')
  execute({ 'kill', '-STOP', tostring(hosts[two].pid) })
  local deadline = vim.uv.hrtime() + 16000000000
  wait(function()
    assert(#list() == 2, 'suspended owner lost server')
    return vim.uv.hrtime() >= deadline
  end, 'suspended owner observation timed out', 17000)
  execute({ 'kill', '-CONT', tostring(hosts[two].pid) })
  keys(one, ':qa!<CR>')
  wait(function()
    return not alive(hosts[one].pid) and #list() == 1
  end, 'Neovim exit left owned server')
  execute({ 'kill', '-KILL', tostring(hosts[two].pid) })
  wait(function()
    return #list() == 0
  end, 'crashed owner left orphan server')
  print 'media-glance real Neovim integration: OK'
end
local ok, failure = xpcall(run, debug.traceback)
local cleanup_failures = {}
local function cleanup_step(callback)
  local done, detail = pcall(callback)
  if not done then
    cleanup_failures[#cleanup_failures + 1] = tostring(detail)
  end
end
for _, host in ipairs(hosts) do
  cleanup_step(function()
    if alive(host.pid) then
      execute({ 'kill', '-CONT', tostring(host.pid) })
      vim.fn.jobstop(host.job)
    end
    vim.fn.jobwait({ host.job }, 5000)
    assert(not alive(host.pid), 'fixture left Neovim alive')
  end)
end
for _, channel in ipairs(channels) do
  cleanup_step(function()
    if vim.api.nvim_get_chan_info(channel).id then
      vim.fn.chanclose(channel)
    end
  end)
end
cleanup_step(function()
  for _, server in ipairs(list()) do
    execute({ binary, 'stop', '--state-dir', state, '--instance', server.instance })
  end
  for pid in pairs(tracked) do
    wait(function()
      return not alive(pid)
    end, 'fixture left viewer alive')
  end
end)
cleanup_step(function()
  assert(vim.fn.delete(fixture, 'rf') == 0 and not vim.uv.fs_stat(fixture), 'fixture removal failed')
end)
assert(#cleanup_failures == 0, table.concat(cleanup_failures, '\n'))
assert(ok, failure)
