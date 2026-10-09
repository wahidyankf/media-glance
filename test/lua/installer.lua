local installer = require 'media-glance.install'
local directory = vim.fn.tempname() .. '-install-unit'
local originals = {
  system = vim.system,
  uname = vim.uv.os_uname,
  executable = vim.fn.executable,
  mkdir = vim.fn.mkdir,
  chmod = vim.uv.fs_chmod,
  rename = vim.uv.fs_rename,
  delete = vim.fn.delete,
}
local failure_stage, commands, hash_command = nil, {}, 'shasum'
local hash = string.rep('a', 64)
local platform = { sysname = 'Darwin', machine = 'arm64' }
vim.uv.os_uname = function()
  return platform
end
vim.fn.executable = function(name)
  if name == 'curl' then
    return failure_stage == 'no-curl' and 0 or 1
  end
  if name == 'shasum' or name == 'sha256sum' then
    return name == hash_command and 1 or 0
  end
  return originals.executable(name)
end
vim.fn.mkdir = function(...)
  if failure_stage == 'mkdir' then
    error 'mkdir failure'
  end
  return originals.mkdir(...)
end
vim.uv.fs_chmod = function(...)
  if failure_stage == 'chmod' then
    return nil, 'chmod failure'
  end
  return originals.chmod(...)
end
vim.uv.fs_rename = function(...)
  if failure_stage == 'rename' then
    return nil, 'rename failure'
  end
  return originals.rename(...)
end
vim.fn.delete = function(path, flags)
  local result = originals.delete(path, flags)
  return failure_stage == 'cleanup' and path:match 'install.lock$' and -1 or result
end
vim.system = function(args, options)
  commands[#commands + 1] = args
  assert(options.timeout > 0, 'subprocess lacks timeout')
  if failure_stage == 'system-throw' then
    error 'system launch failed'
  end
  local result = { code = 0, stdout = '', stderr = '' }
  if args[1] == 'curl' then
    assert(args[2] == '--proto' and args[3] == '=https', 'download permits an insecure protocol')
    local destination, url = args[#args - 1], args[#args]
    assert(
      url:find('releases/download/v0.1.3/media-glance_v0.1.3_', 1, true),
      'installer did not download the matching release'
    )
    local checksum = url:match '%.sha256$'
    if (failure_stage == 'download' and not checksum) or (failure_stage == 'checksum-download' and checksum) then
      result.code, result.stderr = 22, 'HTTP failure'
    elseif checksum then
      local name = url:match '/([^/]+)%.sha256$'
      vim.fn.writefile({ failure_stage == 'checksum-shape' and 'invalid' or hash .. '  ' .. name }, destination)
    else
      vim.fn.writefile({ 'synthetic binary' }, destination)
    end
  elseif args[1] == 'shasum' or args[1] == 'sha256sum' then
    result.stdout = (failure_stage == 'checksum-mismatch' and string.rep('b', 64) or hash) .. '  ' .. args[#args]
    if failure_stage == 'hash' then
      result.code, result.stderr = 1, 'hash failure'
    end
  elseif args[2] == 'version' then
    result.stdout = failure_stage == 'version-json' and 'garbled'
      or vim.json.encode({
        version = failure_stage == 'version' and 'v9.9.9' or 'v0.1.3',
        protocol = 1,
      })
    if failure_stage == 'version-failed' then
      result.code, result.stderr = 1, 'version failure'
    end
  else
    error('unexpected installer command: ' .. vim.inspect(args))
  end
  return {
    wait = function()
      return result
    end,
  }
end
local function run()
  local path, failure = installer.install 'relative'
  assert(not path and failure:find 'absolute', 'relative cache accepted')
  platform = { sysname = 'Windows', machine = 'x86_64' }
  path, failure = installer.install(directory)
  assert(not path and failure:find 'unsupported', 'Windows accepted')
  platform = { sysname = 'Darwin', machine = 'arm64' }
  path, failure = installer.install(directory)
  assert(
    path == directory .. '/v0.1.3/media-glance' and not failure,
    'matching release did not install into its versioned cache: ' .. tostring(failure)
  )
  originals.delete(path)
  for _, stage in ipairs({
    'no-curl',
    'no-hash',
    'mkdir',
    'download',
    'checksum-download',
    'checksum-shape',
    'hash',
    'checksum-mismatch',
    'chmod',
    'version',
    'version-json',
    'version-failed',
    'rename',
    'cleanup',
    'system-throw',
  }) do
    failure_stage = stage
    hash_command = stage == 'no-hash' and '' or 'shasum'
    path, failure = installer.install(directory)
    assert(not path and type(failure) == 'string', 'installer accepted failure: ' .. stage)
    assert(not vim.uv.fs_stat(directory .. '/v0.1.3/install.lock'), 'failed install left lock: ' .. stage)
    if stage ~= 'cleanup' then
      assert(not vim.uv.fs_stat(directory .. '/v0.1.3/media-glance'), 'failed install published binary: ' .. stage)
    else
      originals.delete(directory .. '/v0.1.3/media-glance')
    end
  end
  failure_stage, hash_command = nil, 'shasum'
  assert(vim.uv.fs_mkdir(directory .. '/v0.1.3/install.lock', 448))
  path, failure = installer.install(directory)
  assert(not path and failure:find 'locked', 'concurrent install bypassed lock')
  originals.delete(directory .. '/v0.1.3/install.lock', 'rf')
  path, failure = installer.install(directory)
  assert(path == directory .. '/v0.1.3/media-glance' and not failure, 'valid release was not installed')
  assert(vim.fn.executable(path) == 1, 'installed binary is not executable')
  platform = { sysname = 'Linux', machine = 'aarch64' }
  hash_command = 'sha256sum'
  path, failure = installer.install(directory)
  assert(path and not failure, 'Linux SHA256SUM path failed')
  assert(commands[#commands][2] == 'version', 'binary was not version checked')
  print 'media-glance installer scenarios: OK'
end
local ok, failure = xpcall(run, debug.traceback)
vim.system, vim.uv.os_uname, vim.fn.executable, vim.fn.mkdir =
  originals.system, originals.uname, originals.executable, originals.mkdir
vim.uv.fs_chmod, vim.uv.fs_rename, vim.fn.delete = originals.chmod, originals.rename, originals.delete
originals.delete(directory, 'rf')
assert(ok, failure)
