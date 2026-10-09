import { fileURLToPath } from "node:url";
import { main } from "./tooling.mjs";
const outcome = main(
  process.argv.slice(2),
  fileURLToPath(new URL("..", import.meta.url)),
);
if (outcome.error) console.error(outcome.error);
process.exitCode = outcome.code;
