import { checked } from "./command.mjs";
export { checked } from "./command.mjs";
import { installTools } from "./tools.mjs";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  cpSync,
  statSync,
} from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export const version = "v0.1.0";
export const targets = [
  "darwin_arm64",
  "darwin_amd64",
  "linux_arm64",
  "linux_amd64",
];
export function inventory(root, directory, suffix) {
  const result = [];
  for (const entry of readdirSync(join(root, directory), {
    withFileTypes: true,
  }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = join(directory, entry.name);
    if (
      [
        "vendor",
        "node_modules",
        ".git",
        ".deps",
        ".coverage",
        "worktrees",
        "build",
        "dist",
      ].includes(entry.name)
    )
      continue;
    if (entry.isDirectory()) result.push(...inventory(root, name, suffix));
    else if (suffix.test(entry.name)) result.push(name.split("\\").join("/"));
  }
  return result;
}
export function vendor(
  root,
  io = { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync },
) {
  const pkg = JSON.parse(io.readFileSync(join(root, "package.json"), "utf8"));
  for (const name of ["mermaid", "katex"]) {
    const installed = JSON.parse(
      io.readFileSync(join(root, "node_modules", name, "package.json"), "utf8"),
    );
    if (installed.version !== pkg.devDependencies[name])
      throw new Error(`${name} version does not match its exact pin`);
  }
  const source = join(root, "node_modules/mermaid/dist");
  const output = join(root, "web/vendor");
  io.writeFileSync(
    join(root, "node_modules/go.mod"),
    "module media-glance-vendor\ngo 1.26\n",
  );
  const math = io.readFileSync(
    join(root, "node_modules/katex/dist/katex.mjs"),
    "utf8",
  );
  if (!math.includes(`var version = "${pkg.devDependencies.katex}"`))
    throw new Error("Patched KaTeX version marker missing");
  const chunk = "katex-C5OPUE3Q.mjs";
  if (!io.readdirSync(join(source, "chunks/mermaid.esm.min")).includes(chunk))
    throw new Error(
      "Expected Mermaid math chunk changed; inspect upstream graph before updating",
    );
  io.rmSync(output, { recursive: true, force: true });
  io.mkdirSync(output, { recursive: true });
  io.cpSync(
    join(source, "mermaid.esm.min.mjs"),
    join(output, "mermaid.esm.min.mjs"),
  );
  io.mkdirSync(join(output, "chunks/mermaid.esm.min"), { recursive: true });
  for (const name of io.readdirSync(join(source, "chunks/mermaid.esm.min"))) {
    if (name.endsWith(".mjs"))
      io.cpSync(
        join(source, "chunks/mermaid.esm.min", name),
        join(output, "chunks/mermaid.esm.min", name),
      );
  }
  io.writeFileSync(join(output, "chunks/mermaid.esm.min", chunk), math);
}
export function build(
  root,
  run = spawnSync,
  platform = process.platform,
  arch = process.arch,
) {
  checked(
    "go",
    ["build", "-trimpath", "-o", join(root, "build/media-glance"), "."],
    {
      cwd: root,
      env: {
        ...process.env,
        CGO_ENABLED: "0",
        GOTOOLCHAIN: "go1.26.8",
        GOOS: platform,
        GOARCH: arch === "x64" ? "amd64" : arch,
      },
    },
    run,
  );
}
export function checkCoverage(
  root,
  since,
  io = { readFileSync, statSync },
  sources,
) {
  const files = sources ?? {
    go: inventory(root, ".", /\.go$/).filter(
      (p) =>
        !p.includes("/worktrees/") &&
        !p.startsWith("worktrees/") &&
        !p.endsWith("_test.go") &&
        !p.startsWith("node_modules/"),
    ),
    lua: inventory(root, "lua", /\.lua$/),
    js: [
      ...inventory(root, "web", /\.js$/),
      ...inventory(root, "scripts", /\.mjs$/),
    ],
  };
  const reports = {
    go: ".coverage/go.out",
    lua: ".coverage/lua.json",
    js: ".coverage/js/coverage-summary.json",
  };
  const outcomes = {};
  for (const lang of ["go", "lua", "js"]) {
    const path = join(root, reports[lang]);
    if (io.statSync(path).mtimeMs < since)
      throw new Error(`${lang} coverage report is stale`);
    const coveredFiles = new Map();
    let covered = 0,
      total = 0;
    if (lang === "go") {
      const lines = io.readFileSync(path, "utf8").trim().split("\n");
      if (!/^mode: (set|count|atomic)$/.test(lines[0]))
        throw new Error("Malformed Go coverage mode");
      const blocks = new Map();
      for (const line of lines.slice(1)) {
        const match = line.match(/^(.+):(\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/);
        if (!match) throw new Error("Malformed Go coverage");
        const file = match[1].replace(
          /^github\.com\/wahidyankf\/media-glance\//,
          "",
        );
        if (!files.go.includes(file))
          throw new Error(`Unexpected go coverage source: ${file}`);
        const count = Number(match[3]);
        const key = `${file}:${match[2]}`;
        const previous = blocks.get(key);
        if (previous && previous.count !== count)
          throw new Error("Inconsistent Go coverage block");
        blocks.set(key, {
          count,
          covered: Boolean(previous?.covered || Number(match[4]) > 0),
        });
        coveredFiles.set(file, true);
      }
      for (const block of blocks.values()) {
        total += block.count;
        if (block.covered) covered += block.count;
      }
    } else {
      const report = JSON.parse(io.readFileSync(path, "utf8"));
      const entries = lang === "lua" ? report.files : report;
      for (const [name, data] of Object.entries(entries)) {
        if (name === "total") continue;
        const normalized = name.startsWith(root)
          ? relative(root, name).split("\\").join("/")
          : name;
        const metric = lang === "lua" ? data : data.lines;
        if (
          !metric ||
          !Number.isInteger(metric.covered) ||
          !Number.isInteger(metric.total) ||
          metric.covered < 0 ||
          metric.total < metric.covered
        )
          throw new Error(`Invalid ${lang} coverage counts`);
        if (!files[lang].includes(normalized))
          throw new Error(`Unexpected ${lang} coverage source: ${normalized}`);
        coveredFiles.set(normalized, true);
        covered += metric.covered;
        total += metric.total;
      }
    }
    if (
      !files[lang].length ||
      files[lang].some((file) => !coveredFiles.has(file))
    )
      throw new Error(`${lang} coverage source inventory is incomplete`);
    if (!total || covered * 100 < total * 99)
      throw new Error(`${lang} coverage below 99%: ${covered}/${total}`);
    outcomes[lang] = { covered, total, percent: (covered / total) * 100 };
  }
  return outcomes;
}
export function release(
  root,
  run = spawnSync,
  io = { readFileSync, writeFileSync, mkdirSync },
) {
  const destination = join(root, "dist");
  io.mkdirSync(destination, { recursive: true });
  let manifest = "";
  for (const target of targets) {
    const [platform, arch] = target.split("_");
    const name = `media-glance_${version}_${target}`;
    checked(
      "go",
      [
        "build",
        "-trimpath",
        "-ldflags=-s -w",
        "-o",
        join(destination, name),
        ".",
      ],
      {
        cwd: root,
        env: {
          ...process.env,
          CGO_ENABLED: "0",
          GOTOOLCHAIN: "go1.26.8",
          GOOS: platform,
          GOARCH: arch,
        },
      },
      run,
    );
    const digest = createHash("sha256")
      .update(io.readFileSync(join(destination, name)))
      .digest("hex");
    const line = `${digest}  ${name}\n`;
    manifest += line;
    io.writeFileSync(join(destination, `${name}.sha256`), line);
  }
  io.writeFileSync(join(destination, "checksums.txt"), manifest);
}
export function dispatch(
  command,
  root,
  run = spawnSync,
  io = { mkdirSync, rmSync },
  now = Date.now,
  tools = installTools,
) {
  const exec = (cmd, args, opts = {}) =>
    checked(cmd, args, { cwd: root, ...opts }, run);
  if (command === "tools") return tools(root);
  if (command === "setup")
    return exec("git", ["config", "core.hooksPath", ".githooks"]);
  if (command === "vendor") return vendor(root);
  if (command === "build") {
    vendor(root);
    io.mkdirSync(join(root, "build"), { recursive: true });
    return build(root, run);
  }
  if (command === "release") {
    vendor(root);
    return release(root, run);
  }
  if (command === "fast") {
    exec("npx", ["--no-install", "prettier", "--check", "."]);
    exec("npx", ["--no-install", "eslint", "."]);
    for (const file of [
      ...inventory(root, "web", /\.js$/),
      ...inventory(root, "scripts", /\.mjs$/),
    ])
      exec(process.execPath, ["--check", file]);
    exec("go", ["vet", "./..."], {
      env: { ...process.env, GOTOOLCHAIN: "go1.26.8" },
    });
    exec("golangci-lint", ["run"], {
      env: { ...process.env, GOTOOLCHAIN: "go1.26.8" },
    });
    const format = exec("gofmt", ["-l", "."], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (format.stdout.trim())
      throw new Error(`gofmt required: ${format.stdout}`);
    exec(join(root, ".deps/bin/stylua"), ["--check", "lua", "test/lua"]);
    const runtime = exec(
      "nvim",
      [
        "--headless",
        "-u",
        "NONE",
        "-c",
        "lua io.write(vim.env.VIMRUNTIME)",
        "-c",
        "qa",
      ],
      { stdio: "pipe", encoding: "utf8" },
    ).stdout.trim();
    if (!runtime) throw new Error("Neovim runtime path was empty");
    exec(
      join(root, ".deps/lua-language-server/bin/lua-language-server"),
      [
        "--check=.",
        "--configpath=.luarc.json",
        "--checklevel=Warning",
        "--logpath=.coverage/luals",
      ],
      { env: { ...process.env, VIMRUNTIME: runtime } },
    );
    exec("bash", ["-n", ".githooks/pre-push"]);
    exec("shellcheck", [".githooks/pre-push"]);
    exec("shfmt", ["-d", ".githooks/pre-push"]);
    return;
  }
  if (command === "unit") {
    const start = now();
    io.rmSync(join(root, ".coverage"), { recursive: true, force: true });
    io.mkdirSync(join(root, ".coverage"), { recursive: true });
    exec(
      "go",
      [
        "test",
        "-count=1",
        "-p=2",
        "-parallel=2",
        "-coverpkg=./...",
        "-coverprofile=.coverage/go.out",
        "./...",
      ],
      { env: { ...process.env, GOTOOLCHAIN: "go1.26.8" } },
    );
    exec("nvim", ["--headless", "-u", "NONE", "-l", "test/lua/unit.lua"]);
    exec("npx", [
      "--no-install",
      "c8",
      "--all",
      "--include=web/*.js",
      "--include=scripts/*.mjs",
      "--exclude=web/vendor/**",
      "--reports-dir=.coverage/js",
      "--reporter=json-summary",
      "--reporter=text",
      "node",
      "--test",
      "--test-concurrency=2",
      "test/unit/*.test.mjs",
    ]);
    return checkCoverage(root, start);
  }
  if (command === "integration") {
    exec(
      "go",
      [
        "test",
        "-count=1",
        "-parallel=2",
        "-race",
        "-tags=integration",
        "./...",
      ],
      {
        env: { ...process.env, GOTOOLCHAIN: "go1.26.8" },
      },
    );
    exec(process.execPath, [
      "--test",
      "--test-concurrency=2",
      "test/integration/*.test.mjs",
    ]);
    return exec("nvim", [
      "--headless",
      "-u",
      "NONE",
      "-l",
      "test/lua/integration.lua",
    ]);
  }
  if (command === "browser" || command === "browser-install")
    return exec(
      "npx",
      [
        "--no-install",
        "playwright",
        ...(command === "browser"
          ? ["test", "--workers=1"]
          : ["install", "--with-deps", "chromium"]),
      ],
      {
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: join(root, ".deps/playwright"),
          PLAYWRIGHT_SKIP_BROWSER_GC: "1",
        },
      },
    );
  if (command === "complete") {
    for (const step of ["build", "unit", "fast", "integration", "browser"])
      dispatch(step, root, run, io, now);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}
export function main(args, root, options = {}) {
  try {
    if (args.length !== 1)
      throw new Error(
        "Usage: node scripts/cli.mjs <setup|tools|vendor|build|unit|fast|integration|browser|browser-install|complete|release>",
      );
    return {
      code: 0,
      result: dispatch(
        args[0],
        resolve(root),
        options.run,
        options.io,
        options.now,
      ),
    };
  } catch (error) {
    return { code: 1, error: error.message };
  }
}
