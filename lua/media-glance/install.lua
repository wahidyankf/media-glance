local M = {}
local version = 'v0.1.1'

---@param arguments string[]
---@param timeout integer
---@return string|nil
---@return string|nil
local function execute(arguments, timeout)
  local ok, result = pcall(function()
    return vim.system(arguments, { text = true, timeout = timeout }):wait(timeout + 1000)
  end)
  if not ok then
    return nil, tostring(result)
  end
  if result.code ~= 0 then
    return nil, vim.trim(result.stderr or ('status ' .. result.code))
  end
  return result.stdout or '', nil
end

---@param filename string
---@return boolean
---@return string|nil
local function compatible(filename)
  local output, failure = execute({ filename, 'version', '--json' }, 5000)
  if not output then
    return false, failure
  end
  local ok, value = pcall(vim.json.decode, output)
  if not ok or type(value) ~= 'table' or value.version ~= version or value.protocol ~= 1 then
    return false, 'release binary has an incompatible version or protocol'
  end
  return true, nil
end

---Download, verify, and atomically install the plugin's matching release.
---Expected download, verification, locking, and filesystem failures are returned.
---@param cache_directory string
---@return string|nil path
---@return string|nil failure
function M.install(cache_directory)
  if type(cache_directory) ~= 'string' or cache_directory:sub(1, 1) ~= '/' then
    return nil, 'cache directory must be absolute'
  end
  local platform = vim.uv.os_uname()
  local operating_system = ({ Darwin = 'darwin', Linux = 'linux' })[platform.sysname]
  local architecture = ({ arm64 = 'arm64', aarch64 = 'arm64', x86_64 = 'amd64', amd64 = 'amd64' })[platform.machine]
  if not operating_system or not architecture then
    return nil, 'unsupported platform: ' .. platform.sysname .. '/' .. platform.machine
  end
  if vim.fn.executable 'curl' ~= 1 then
    return nil, 'curl is required for explicit installation'
  end
  local checksum_command = vim.fn.executable 'shasum' == 1 and { 'shasum', '-a', '256' }
    or vim.fn.executable 'sha256sum' == 1 and { 'sha256sum' }
  if not checksum_command then
    return nil, 'shasum or sha256sum is required to verify the release'
  end
  local directory = vim.fs.joinpath(cache_directory, version)
  local created, create_failure = pcall(vim.fn.mkdir, directory, 'p')
  if not created then
    return nil, 'could not create cache directory: ' .. tostring(create_failure)
  end
  local lock = directory .. '/install.lock'
  local locked, lock_failure = vim.uv.fs_mkdir(lock, 448)
  if not locked then
    return nil, 'installation is already locked or unavailable: ' .. tostring(lock_failure)
  end
  local target = directory .. '/media-glance'
  local temporary = lock .. '/media-glance'
  local checksum_file = lock .. '/checksum'
  local function download(asset, destination)
    local base = 'https://github.com/wahidyankf/media-glance/releases/download/' .. version .. '/'
    return execute({
      'curl',
      '--proto',
      '=https',
      '--proto-redir',
      '=https',
      '--tlsv1.2',
      '--fail',
      '--location',
      '--silent',
      '--show-error',
      '--connect-timeout',
      '10',
      '--max-time',
      '60',
      '--output',
      destination,
      base .. asset,
    }, 65000)
  end
  local successful, failure = xpcall(function()
    local asset = 'media-glance_' .. version .. '_' .. operating_system .. '_' .. architecture
    local binary_output, binary_failure = download(asset, temporary)
    if not binary_output then
      return binary_failure
    end
    local checksum_output, checksum_failure = download(asset .. '.sha256', checksum_file)
    if not checksum_output then
      return checksum_failure
    end
    local lines = vim.fn.readfile(checksum_file)
    local expected, name = (lines[1] or ''):match '^([a-fA-F0-9]+)%s+%*?([^%s]+)%s*$'
    if #lines ~= 1 or not expected or #expected ~= 64 or name ~= asset then
      return 'release checksum response is invalid'
    end
    table.insert(checksum_command, temporary)
    local actual, actual_failure = execute(checksum_command, 10000)
    if not actual then
      return actual_failure
    end
    if actual:sub(1, 64):lower() ~= expected:lower() then
      return 'release checksum does not match'
    end
    local chmod_ok, chmod_failure = vim.uv.fs_chmod(temporary, 493)
    if not chmod_ok then
      return 'could not make binary executable: ' .. tostring(chmod_failure)
    end
    local version_ok, version_failure = compatible(temporary)
    if not version_ok then
      return version_failure
    end
    local renamed, rename_failure = vim.uv.fs_rename(temporary, target)
    if not renamed then
      return 'could not publish binary: ' .. tostring(rename_failure)
    end
    return nil
  end, debug.traceback)
  local removed = vim.fn.delete(lock, 'rf')
  if removed ~= 0 then
    return nil, 'could not clean installation lock: ' .. lock
  end
  if not successful or failure then
    return nil, tostring(failure)
  end
  return target, nil
end

return M
