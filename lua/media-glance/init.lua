local M = {}

---@class WorkspaceMediaServer
---@field type string
---@field version integer
---@field instance string
---@field root string
---@field port integer
---@field url string
---@field ownerPid integer
---@field pid integer

---@class MediaGlanceOptions
---@field root? fun(): string
---@field binary? string
---@field state_dir? string
---@field cache_dir? string

---@type MediaGlanceOptions
local options = {}
local function default_cache()
  local cache = vim.fn.stdpath 'cache'
  assert(type(cache) == 'string', 'stdpath(cache) must return a string')
  return vim.fs.joinpath(cache, 'media-glance')
end
local function state_directory()
  if options.state_dir then
    return options.state_dir
  end
  local state = vim.fn.stdpath 'state'
  assert(type(state) == 'string', 'stdpath(state) must return a string')
  return vim.fs.joinpath(state, 'media-glance')
end
local startup_timeout_ms = 30000
local job_id = nil
---@type WorkspaceMediaServer|nil
local owned_server = nil
local starting_root = nil
local pending_file = ''
local stopping = false

---@param message string
local function notify_error(message)
  vim.notify('media-glance.nvim: ' .. message, vim.log.levels.ERROR)
end

---@param text string
---@return table|nil
local function decode(text)
  local ok, value = pcall(vim.json.decode, text)
  if ok and type(value) == 'table' then
    return value
  end
  return nil
end

---@param value unknown
---@return WorkspaceMediaServer|nil
local function parse_server(value)
  if type(value) ~= 'table' then
    return nil
  end
  local valid = value.type == 'ready'
    and value.version == 1
    and type(value.instance) == 'string'
    and value.instance:match '^[a-f0-9]+%-[a-f0-9]+%-[a-f0-9]+%-[a-f0-9]+%-[a-f0-9]+$' ~= nil
    and #value.instance == 36
    and value.instance:sub(9, 9) == '-'
    and value.instance:sub(14, 14) == '-'
    and value.instance:sub(19, 19) == '-'
    and value.instance:sub(24, 24) == '-'
    and type(value.root) == 'string'
    and value.root:sub(1, 1) == '/'
    and type(value.port) == 'number'
    and value.port % 1 == 0
    and value.port >= 57300
    and value.port <= 57399
    and type(value.pid) == 'number'
    and value.pid > 0
    and value.pid % 1 == 0
    and type(value.ownerPid) == 'number'
    and value.ownerPid > 0
    and value.ownerPid % 1 == 0
    and type(value.url) == 'string'
    and value.url:match('^http://127%.0%.0%.1:' .. value.port .. '/v/[a-f0-9]+/%??[^%s]*$') ~= nil
  if not valid then
    return nil
  end
  return {
    type = value.type,
    version = value.version,
    instance = value.instance,
    root = value.root,
    port = value.port,
    url = value.url,
    ownerPid = value.ownerPid,
    pid = value.pid,
  }
end

---@param root string
---@param candidate string
---@return boolean
local function within_root(root, candidate)
  local prefix = root:sub(-1) == '/' and root or root .. '/'
  return candidate ~= root and candidate:sub(1, #prefix) == prefix
end

---@param root string
---@param filename? string
---@return string
local function initial_file(root, filename)
  local candidate = vim.uv.fs_realpath(filename or vim.api.nvim_buf_get_name(0))
  if candidate and within_root(root, candidate) then
    local stat = vim.uv.fs_stat(candidate)
    if stat and stat.type == 'file' then
      return candidate
    end
  end
  local readme = vim.uv.fs_realpath(vim.fs.joinpath(root, 'README.md'))
  local stat = readme and vim.uv.fs_stat(readme)
  if readme and within_root(root, readme) and stat and stat.type == 'file' then
    return readme
  end
  return ''
end

---@param value string
---@return string
local function encode_query(value)
  return (value:gsub('[^%w%-_%.~]', function(character)
    return ('%%%02X'):format(character:byte())
  end))
end

---@param server WorkspaceMediaServer
---@param filename string|nil
local function open_browser(server, filename)
  local url = server.url
  if filename ~= nil then
    url = url:gsub('%?.*$', '')
    if filename ~= '' and within_root(server.root, filename) then
      local prefix = server.root:sub(-1) == '/' and server.root or server.root .. '/'
      url = url .. '?file=' .. encode_query(filename:sub(#prefix + 1))
    end
  end
  local process, failure = vim.ui.open(url)
  if not process then
    notify_error('could not open browser: ' .. tostring(failure))
  end
end

---@return string|nil
local function locate_binary()
  local path = options.binary or vim.fs.joinpath(options.cache_dir or default_cache(), 'v0.1.2', 'media-glance')
  if vim.fn.executable(path) ~= 1 then
    notify_error 'binary is unavailable. Run :MediaGlanceInstall explicitly or configure binary.'
    return nil
  end
  return path
end

---Install the matching verified release explicitly; opening never downloads.
---@return string|nil path
---@return string|nil failure
function M.install()
  local path, failure = require('media-glance.install').install(options.cache_dir or default_cache())
  if not path then
    notify_error('could not install: ' .. tostring(failure))
  else
    vim.notify('media-glance.nvim installed ' .. path)
  end
  return path, failure
end

---Stop only this Neovim session's owned server through its ownership pipe.
---@return nil
function M.shutdown()
  if not job_id or stopping then
    return
  end
  stopping = true
  local sent_ok, send_error = pcall(vim.fn.chansend, job_id, 'stop\n')
  local close_ok, close_error = pcall(vim.fn.chanclose, job_id, 'stdin')
  if not sent_ok and not close_ok then
    notify_error('could not close ownership pipe: ' .. tostring(send_error) .. '; ' .. tostring(close_error))
  end
end

---Start this session's viewer or reopen it with the active saved file in its root.
---A missing cached build is reported without building or admitting work.
---@return nil
function M.open()
  if job_id then
    if stopping then
      vim.notify('media-glance.nvim is stopping; open again after it exits.', vim.log.levels.WARN)
    elseif owned_server then
      open_browser(owned_server, initial_file(owned_server.root))
    elseif starting_root then
      pending_file = initial_file(starting_root)
    end
    return
  end
  local root_ok, workspace = pcall(options.root or function()
    return vim.fn.getcwd(-1, -1)
  end)
  if not root_ok or type(workspace) ~= 'string' then
    notify_error 'workspace root callback failed.'
    return
  end
  local root = workspace and vim.uv.fs_realpath(workspace)
  local stat = root and vim.uv.fs_stat(root)
  if not root or not stat or stat.type ~= 'directory' then
    notify_error 'workspace root is unavailable.'
    return
  end
  local binary = locate_binary()
  if not binary then
    return
  end
  starting_root, pending_file, stopping = root, initial_file(root), false
  local stdout_fragment, stderr_lines = '', {}
  local launched, started = pcall(vim.fn.jobstart, {
    binary,
    'serve',
    '--root',
    root,
    '--owner-pid',
    tostring(vim.fn.getpid()),
    '--state-dir',
    state_directory(),
    '--initial-file',
    pending_file,
  }, {
    stdin = 'pipe',
    on_stdout = function(id, lines)
      for index, fragment in ipairs(lines) do
        if index == 1 then
          stdout_fragment = stdout_fragment .. fragment
        else
          local value = parse_server(decode(stdout_fragment))
          stdout_fragment = fragment
          if value and not owned_server then
            vim.schedule(function()
              if job_id ~= id or stopping or owned_server then
                return
              end
              if value.root ~= starting_root or value.ownerPid ~= vim.fn.getpid() then
                notify_error 'server readiness has a different workspace or owner.'
                M.shutdown()
                return
              end
              owned_server = value
              open_browser(value, pending_file)
              vim.notify(('media-glance.nvim: %s (port %d)'):format(value.root, value.port))
            end)
          end
        end
      end
    end,
    on_stderr = function(_, lines)
      for _, line in ipairs(lines) do
        if line ~= '' then
          table.insert(stderr_lines, line)
        end
      end
    end,
    on_exit = function(id, code)
      vim.schedule(function()
        if job_id ~= id then
          return
        end
        local expected, was_ready = stopping, owned_server ~= nil
        job_id, owned_server, starting_root, stopping = nil, nil, nil, false
        if not expected and (code ~= 0 or not was_ready) then
          notify_error(
            'server exited: ' .. (#stderr_lines > 0 and table.concat(stderr_lines, '\n') or ('status ' .. code))
          )
        end
      end)
    end,
  })
  if not launched or type(started) ~= 'number' or started <= 0 then
    starting_root = nil
    notify_error 'could not start the cached server.'
    return
  end
  job_id = started
  vim.defer_fn(function()
    if job_id == started and not owned_server and not stopping then
      notify_error 'server was not ready within 30 seconds.'
      M.shutdown()
    end
  end, startup_timeout_ms)
end

---@param action 'open'|'close'
local function select_server(action)
  -- Capture the workspace buffer before Telescope takes focus for its prompt.
  local focused_filename = vim.api.nvim_buf_get_name(0)
  local binary = locate_binary()
  if not binary then
    return
  end
  local ok, failure = pcall(
    vim.system,
    { binary, 'list', '--state-dir', state_directory() },
    { text = true, timeout = 10000 },
    function(result)
      vim.schedule(function()
        local value = result.code == 0 and decode(result.stdout or '') or nil
        if not value or value.type ~= 'list' or value.version ~= 1 or type(value.servers) ~= 'table' then
          notify_error('could not list servers: ' .. vim.trim(result.stderr or 'invalid server response'))
          return
        end
        local choices = {}
        for _, raw in ipairs(value.servers) do
          local server = parse_server(raw)
          if not server then
            notify_error 'server list contained an invalid record.'
            return
          end
          table.insert(choices, server)
        end
        table.sort(choices, function(left, right)
          local left_owned = owned_server and left.instance == owned_server.instance
          local right_owned = owned_server and right.instance == owned_server.instance
          if left_owned ~= right_owned then
            return left_owned == true
          end
          return left.port < right.port
        end)
        if #choices == 0 then
          vim.notify 'media-glance.nvim: no running servers.'
          return
        end
        vim.ui.select(choices, {
          prompt = action == 'open' and 'Open media server (Enter opens, Esc cancels)'
            or 'Close media server (Enter stops, Esc cancels)',
          format_item = function(server)
            local label = owned_server and server.instance == owned_server.instance and ' [this session]' or ''
            return ('%s | owner %d%s | :%d'):format(server.root, server.ownerPid, label, server.port)
          end,
        }, function(server)
          if not server then
            return
          end
          if action == 'open' then
            open_browser(server, initial_file(server.root, focused_filename))
            return
          end
          local stop_ok, stop_failure = pcall(
            vim.system,
            { binary, 'stop', '--state-dir', state_directory(), '--instance', server.instance },
            { text = true, timeout = 10000 },
            function(stopped)
              vim.schedule(function()
                local response = stopped.code == 0 and decode(stopped.stdout or '') or nil
                if
                  not response
                  or response.type ~= 'stopped'
                  or response.version ~= 1
                  or response.instance ~= server.instance
                then
                  notify_error('could not stop server: ' .. vim.trim(stopped.stderr or 'invalid server response'))
                else
                  vim.notify(('media-glance.nvim stopped: %s (port %d)'):format(server.root, server.port))
                end
              end)
            end
          )
          if not stop_ok then
            notify_error('could not stop server: ' .. tostring(stop_failure))
          end
        end)
        -- Telescope's usual Escape leaves insert mode. This picker advertises
        -- cancellation, so make that explicit for this buffer in either mode.
        if vim.bo.filetype == 'TelescopePrompt' then
          local prompt_buffer = vim.api.nvim_get_current_buf()
          vim.keymap.set({ 'i', 'n' }, '<Esc>', function()
            require('telescope.actions').close(prompt_buffer)
          end, { buffer = prompt_buffer, nowait = true, silent = true, desc = 'Cancel media server selection' })
        end
      end)
    end
  )
  if not ok then
    notify_error('could not list servers: ' .. tostring(failure))
  end
end

---List validated servers and open the selected instance; Escape cancels.
---@return nil
function M.list()
  select_server 'open'
end

---List validated servers and stop the selected instance; Escape cancels.
---@return nil
function M.close()
  select_server 'close'
end

---Register commands and lifecycle cleanup without starting a server.
---@return nil
---@param configuration? MediaGlanceOptions
function M.setup(configuration)
  options = configuration or {}
  for name, callback in pairs({
    MediaGlanceOpen = M.open,
    MediaGlanceList = M.list,
    MediaGlanceClose = M.close,
    MediaGlanceInstall = M.install,
  }) do
    vim.api.nvim_create_user_command(
      name,
      callback,
      { desc = 'Workspace media: ' .. name:sub(12):lower(), force = true }
    )
  end
  local group = vim.api.nvim_create_augroup('MediaGlance', { clear = true })
  vim.api.nvim_create_autocmd(
    'VimLeavePre',
    { group = group, callback = M.shutdown, desc = 'Stop this session media viewer' }
  )
end

return M
