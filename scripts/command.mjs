import { spawnSync } from "node:child_process";

export function checked(command, args, options = {}, run = spawnSync) {
  const result = run(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited ${result.status ?? "without a status"}`);
  return result;
}
