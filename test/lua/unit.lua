vim.opt.rtp:prepend(vim.fn.getcwd())
assert(vim.uv.fs_stat '.deps/luacov/src/luacov/runner.lua', 'LuaCov is missing; run npm run tools explicitly')
jit.off()
package.path = '.deps/luacov/src/?.lua;.deps/luacov/src/?/init.lua;' .. package.path
vim.fn.mkdir('.coverage', 'p')
vim.fn.delete '.coverage/luacov.stats'
local runner = require 'luacov.runner'
runner.init({
  statsfile = '.coverage/luacov.stats',
  reportfile = '.coverage/luacov.txt',
  include = { 'lua/media%-glance/' },
  runreport = false,
  tick = false,
})
dofile 'test/lua/core.lua'
dofile 'test/lua/installer.lua'
dofile 'test/lua/failures.lua'
runner.shutdown()
local stats = require 'luacov.stats'
local data = assert(stats.load '.coverage/luacov.stats')
local inventory = vim.fn.glob('lua/**/*.lua', false, true)
assert(#inventory > 0, 'Lua source inventory is empty')
for _, filename in ipairs(inventory) do
  local found = false
  for measured in pairs(data) do
    if measured == filename or measured:sub(-#filename) == filename then
      found = true
    end
  end
  if not found then
    data[filename] = { max = 0, max_hits = 0 }
  end
end
stats.save('.coverage/luacov.stats', data)
local reporter = require 'luacov.reporter'
local result = { files = {}, covered = 0, total = 0 }
local Report = setmetatable({}, reporter.ReporterBase)
Report.__index = Report
function Report:on_mis_line(filename, line, source)
  print(('UNCOVERED %s:%d %s'):format(filename, line, source))
end
function Report:on_end_file(filename, hits, misses)
  local relative = filename:gsub('^' .. vim.pesc(vim.fn.getcwd()) .. '/', '')
  result.files[relative] = { covered = hits, total = hits + misses }
  result.covered, result.total = result.covered + hits, result.total + hits + misses
end
reporter.report(Report)
vim.fn.writefile({ vim.json.encode(result) }, '.coverage/lua.json')
assert(vim.tbl_count(result.files) == #inventory, 'Lua coverage inventory is incomplete')
print(('Lua unit coverage: %d/%d (%.2f%%)'):format(result.covered, result.total, result.covered / result.total * 100))
assert(result.total > 0 and result.covered / result.total >= 0.99, 'Lua unit coverage is below 99%')
