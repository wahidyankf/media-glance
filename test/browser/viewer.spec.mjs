import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { mediaViewerBrowserSpec } from "./journey.mjs";
import { createFixture } from "./process.mjs";

test("focused workspace media, external saves, zoom and lifecycle", async ({
  page,
}) => {
  const fixture = createFixture(resolve("build/media-glance"));
  const watchdog = setTimeout(() => fixture.child.kill("SIGTERM"), 115000);
  try {
    const ready = await fixture.ready;
    await page.goto(ready.fixtureUrl);
    const outcome = await mediaViewerBrowserSpec(page);
    expect(outcome.verdict).toBe("passed");
  } finally {
    clearTimeout(watchdog);
    const stopped = await fixture.stop();
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.cleanup?.cleanup).toBe("complete");
  }
});
