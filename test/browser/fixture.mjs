import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { deflateSync } from "node:zlib";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--binary" || !isAbsolute(args[1])) {
  console.error("Usage: node test/browser/fixture.mjs --binary ABS");
  process.exitCode = 2;
} else {
  await run(args[1]);
}

function checksum(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(red, green, blue) {
  const width = 1600;
  const height = 800;
  function chunk(type, payload) {
    const content = Buffer.concat([Buffer.from(type), payload]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(checksum(content));
    return Buffer.concat([length, content, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const offset = row * (width * 3 + 1) + column * 3 + 1;
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function run(binary) {
  const parentClosed = new Promise((resolveStop) =>
    process.stdin.once("end", resolveStop),
  );
  process.stdin.resume();
  const scratch = await mkdtemp(join(tmpdir(), "media-viewer-browser-"));
  const marker = join(scratch, ".owned-media-viewer-browser");
  await writeFile(marker, "synthetic browser regression fixture\n");
  const root = join(scratch, "workspace");
  const state = join(scratch, "state");
  const nested = join(root, "zz-selected", "nested");
  let child;
  let control;
  let ready;
  let startupTimer;
  const runId = randomUUID();
  try {
    await mkdir(nested, { recursive: true });
    await mkdir(state);
    for (let index = 0; index < 85; index++) {
      const folder = join(root, `a${String(index).padStart(3, "0")}-directory`);
      await mkdir(folder);
      await writeFile(join(folder, "README.md"), "# Synthetic folder\n");
    }
    const diagram = ["erDiagram"];
    for (let index = 0; index < 10; index++) {
      diagram.push(
        `    TABLE_${index} {`,
        "        string synthetic_primary_id PK",
        "        string parent_reference FK",
      );
      for (let field = 0; field < 8; field++)
        diagram.push(`        string descriptive_field_${field}`);
      diagram.push("    }");
      if (index) diagram.push(`    TABLE_0 ||--o{ TABLE_${index} : contains`);
    }
    const markdown =
      "# Selected current file\n\nSynthetic baseline prose remains readable.\n\n```mermaid\n" +
      diagram.join("\n") +
      "\n```\n\n![Wide PNG](large.png)\n\n![Wide SVG](large.svg)\n\n" +
      "[Second document](second.md) · [Invalid diagram](broken.md)\n\n" +
      Array.from(
        { length: 25 },
        (_, index) => `## Section ${index}\n\nSynthetic body paragraph.`,
      ).join("\n\n") +
      "\n";
    const initial = join(nested, "current.md");
    await writeFile(initial, markdown);
    await writeFile(join(nested, "large.png"), png(35, 112, 187));
    await writeFile(
      join(nested, "large.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="900" viewBox="0 0 1800 900"><rect width="1800" height="900" fill="#668822"/><text x="40" y="150" font-size="90">Synthetic SVG corner</text><circle cx="1750" cy="850" r="35" fill="white"/></svg>',
    );
    await writeFile(
      join(nested, "second.md"),
      "# Second document\n\n![Second image](large.svg)\n\n```mermaid\nflowchart LR\nA[Second] --> B[Complete]\n```\n",
    );
    await writeFile(
      join(nested, "math.md"),
      '# Mathematical labels\n\n```mermaid\nflowchart LR\nA["$$x^2 + 1$$"] --> B["$$y$$"]\n```\n',
    );
    await writeFile(
      join(nested, "broken.md"),
      "# Invalid diagram\n\n```mermaid\nnot a diagram !!!\n```\n",
    );
    await writeFile(
      join(nested, "links.md"),
      "# Link behavior\n\n[External guide](https://example.test/guide)\n\n<https://example.test/auto>\n\n[![Linked image](large.svg)](https://example.test/image)\n\n[Local document](second.md)\n\n[Email](mailto:reader@example.test)\n",
    );
    const entity = (name, fields = 3) =>
      name +
      " {\n" +
      Array.from({ length: fields }, (_, i) => " string field_" + i).join(
        "\n",
      ) +
      "\n}";
    const erSamples = [
      "erDiagram\n" +
        entity("DEFAULT_RECORD") +
        "\nclassDef default fill:#0173B2,stroke:#000000,color:#FFFFFF",
      "erDiagram\n" +
        entity("NAMED_RECORD:::green", 1) +
        "\nclassDef green fill:#28643C,color:#FFFFFF",
      "erDiagram\n" +
        entity("DIRECT_RECORD") +
        "\nstyle DIRECT_RECORD fill:#604080,color:#FFFFFF",
      "erDiagram\n" + entity("PLAIN_RECORD"),
      "erDiagram\n" +
        entity("BORDER_RECORD:::border") +
        "\nclassDef border stroke:#a75400",
    ];
    await writeFile(
      join(nested, "er-styles.md"),
      "# ER style examples\n\n" +
        erSamples.map((value) => "```mermaid\n" + value + "\n```").join("\n\n"),
    );
    await writeFile(
      join(nested, "copy.md"),
      '# Code examples\n\nInline `unaffected` code.\n\n```http\nGET /notes?x=1&y=2\n\t{"label":"<safe>"}\n```\n',
    );
    child = spawn(
      binary,
      [
        "serve",
        "--root",
        root,
        "--owner-pid",
        String(process.pid),
        "--state-dir",
        state,
        "--initial-file",
        await realpath(initial),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    child.stderr.on("data", (bytes) => process.stderr.write(bytes));
    const lines = createInterface({ input: child.stdout });
    let startup;
    try {
      startup = await Promise.race([
        once(lines, "line").then(([line]) => JSON.parse(line)),
        once(child, "error").then(([error]) => {
          throw error;
        }),
        once(child, "exit").then(() => {
          throw new Error("Viewer exited before readiness");
        }),
        new Promise((_, reject) => {
          startupTimer = setTimeout(
            () => reject(new Error("Viewer readiness exceeded 10 seconds")),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(startupTimer);
    }
    ready = startup;
    control = createServer(async (request, response) => {
      try {
        if (request.method === "GET" && request.url === "/info") {
          response.setHeader("Content-Type", "application/json");
          response.end(
            JSON.stringify({
              type: "owned-media-viewer-browser-fixture",
              version: 1,
              runId,
              viewerUrl: ready.url,
              initialFile: "zz-selected/nested/current.md",
            }),
          );
        } else if (request.method === "GET" && request.url === "/") {
          response.setHeader("Content-Type", "text/html");
          response.end(
            "<!doctype html><title>Synthetic media viewer fixture</title><p>Owned browser regression fixture.</p>",
          );
        } else if (request.method === "POST" && request.url === "/edit-code") {
          await writeFile(
            join(nested, "copy.md"),
            '# Code examples\n\nInline `unaffected` code.\n\n```json\n{\n\t"saved": "external update"\n}\n```\n',
          );
          response.end("updated");
        } else if (request.method === "POST" && request.url === "/edit-image") {
          await writeFile(join(nested, "large.png"), png(187, 55, 35));
          response.end("updated");
        } else if (
          request.method === "POST" &&
          request.url === "/edit-diagram"
        ) {
          await writeFile(
            initial,
            markdown
              .replace("descriptive_field_0", "externally_updated_field")
              .replace("Synthetic baseline prose", "Externally updated prose"),
          );
          response.end("updated");
        } else if (request.method === "POST" && request.url === "/edit-prose") {
          await writeFile(
            initial,
            (await readFile(initial, "utf8")) +
              "\nExternal sidebar-refresh marker.\n",
          );
          response.end("updated");
        } else {
          response.writeHead(404);
          response.end("Unknown fixture operation");
        }
      } catch (error) {
        response.writeHead(500);
        response.end(error.message);
      }
    });
    control.listen(0, "127.0.0.1");
    await once(control, "listening");
    console.log(
      JSON.stringify({
        fixtureUrl: `http://127.0.0.1:${control.address().port}/`,
        viewerPort: ready.port,
        ownerPid: process.pid,
      }),
    );
    await Promise.race([
      parentClosed,
      new Promise((resolveStop) => {
        process.once("SIGINT", resolveStop);
        process.once("SIGTERM", resolveStop);
        child.once("exit", resolveStop);
      }),
    ]);
  } finally {
    let forcedShutdown = false;
    if (control) {
      const closed = new Promise((resolveClose) => control.close(resolveClose));
      control.closeAllConnections();
      await closed;
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.stdin.end();
      const terminate = setTimeout(() => {
        forcedShutdown = true;
        child.kill("SIGTERM");
      }, 5000);
      const kill = setTimeout(() => {
        forcedShutdown = true;
        child.kill("SIGKILL");
      }, 10_000);
      try {
        await exited;
      } finally {
        clearTimeout(terminate);
        clearTimeout(kill);
      }
    }
    const remaining = await readdir(state).catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    if (
      (await readFile(marker, "utf8")) !==
      "synthetic browser regression fixture\n"
    )
      throw new Error("Cleanup ownership marker changed");
    await rm(scratch, { recursive: true });
    console.log(
      JSON.stringify({
        cleanup: "complete",
        viewerExit: child?.exitCode ?? null,
      }),
    );
    if (forcedShutdown || remaining.some((name) => name.endsWith(".json")))
      throw new Error(
        "Viewer teardown required escalation or left registry records",
      );
  }
}
