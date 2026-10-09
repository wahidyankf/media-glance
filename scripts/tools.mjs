import { checked } from "./command.mjs";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const manifests = {
  darwin_arm64: {
    ls: "darwin-arm64",
    lsSha: "0bc077f4447f076b4c92c14e9fd303f5b569eda2ec74b4dca2b55f75fae2e90c",
    style: "macos-aarch64",
    styleSha:
      "92ff0889e16324801bc072692974bb67f8161e62010fc90f96c62a17f81f32c7",
  },
  darwin_x64: {
    ls: "darwin-x64",
    lsSha: "eb373c159cbe556711d7cd316315de2dce969bfd54b31edb7eb9cab2937f2cca",
    style: "macos-x86_64",
    styleSha:
      "53c50a1605d0a6345d160a1a5a21db40bcf2bf9cd23c17f7c277a63a1bff3a7f",
  },
  linux_x64: {
    ls: "linux-x64",
    lsSha: "e9235d2d72ef55bc41cf8c99cda2ed64777682024b4bb81f5dea425060c5cbb8",
    style: "linux-x86_64",
    styleSha:
      "bcb0d855e91f102f28a370e850f8566b3b44b79e6274d806ea5246837c0fd5ab",
  },
  linux_arm64: {
    ls: "linux-arm64",
    lsSha: "abd2572e8fc929dc838a81ffb8473c5bce0bf39bfe8edb4b120b3b623176ce83",
    style: "linux-aarch64",
    styleSha:
      "0ef2ebf0b7e5a652b65c4cb96c6d9ffb3981a98547de3c764465bbf54a8d761a",
  },
};
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function downloads(platform, arch) {
  const target = manifests[`${platform}_${arch}`];
  if (!target)
    throw new Error(`Unsupported development host: ${platform}/${arch}`);
  return [
    {
      name: "luacov",
      url: "https://codeload.github.com/lunarmodules/luacov/tar.gz/b1f9eae400da976b93edb7f94cf5d05f538a0655",
      sha: "29e688efd84fba20a76f16525516f6cafdf41cc7b4bc95c631966a666f4ed3a0",
      type: "tar",
      strip: true,
      destination: "luacov",
    },
    {
      name: "luals",
      url: `https://github.com/LuaLS/lua-language-server/releases/download/3.19.1/lua-language-server-3.19.1-${target.ls}.tar.gz`,
      sha: target.lsSha,
      type: "tar",
      strip: false,
      destination: "lua-language-server",
    },
    {
      name: "stylua",
      url: `https://github.com/JohnnyMorganz/StyLua/releases/download/v2.5.2/stylua-${target.style}.zip`,
      sha: target.styleSha,
      type: "zip",
      destination: "bin",
    },
  ];
}
export function installTools(
  root,
  {
    platform = process.platform,
    arch = process.arch,
    run = spawnSync,
    io = { mkdirSync, mkdtempSync, readFileSync, rmSync, chmodSync },
    entries = downloads(platform, arch),
  } = {},
) {
  const deps = join(root, ".deps");
  io.mkdirSync(deps, { recursive: true });
  const stage = io.mkdtempSync(join(deps, "download-"));
  const exec = (name, args) => checked(name, args, {}, run);
  try {
    for (const item of entries) {
      const archive = join(stage, item.name);
      exec("curl", ["-fsSL", item.url, "-o", archive]);
      if (sha256(io.readFileSync(archive)) !== item.sha)
        throw new Error(`${item.name} download checksum mismatch`);
      const destination = join(deps, item.destination);
      io.mkdirSync(destination, { recursive: true });
      if (item.type === "zip")
        exec("unzip", ["-oq", archive, "-d", destination]);
      else
        exec("tar", [
          "-xzf",
          archive,
          "-C",
          destination,
          ...(item.strip ? ["--strip-components=1"] : []),
        ]);
    }
    io.chmodSync(join(deps, "bin/stylua"), 0o755);
  } finally {
    io.rmSync(stage, { recursive: true, force: true });
  }
  return deps;
}
