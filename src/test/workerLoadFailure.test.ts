// A twin build whose worker cannot load says why: a page opened before a deploy is told to reload (2026-11-05).
import { describe, expect, it } from "vitest";
import { STALE_PAGE_MESSAGE, workerLoadFailure } from "@/lib/fieldTwin/build/runBuild";

const site = (html: string) => (async () => new Response(html, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
const live = `<script type="module" crossorigin src="/assets/index-NEW.js"></script>`;

describe("why the build worker failed to start", () => {
  it("tells a page opened before a deploy to reload", async () => {
    expect(await workerLoadFailure(undefined, ["/assets/index-OLD.js"], site(live))).toBe(STALE_PAGE_MESSAGE);
  });
  it("does not blame a deploy when the page is current", async () => {
    expect(await workerLoadFailure(undefined, ["/assets/index-NEW.js"], site(live))).toBe("The build worker failed to start.");
  });
  it("keeps the worker's own message, and says only what is known when the site cannot be asked", async () => {
    expect(await workerLoadFailure("boom", ["/assets/index-OLD.js"], site(live))).toBe("boom");
    const offline = (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch;
    expect(await workerLoadFailure(undefined, ["/assets/index-OLD.js"], offline)).toBe("The build worker failed to start.");
  });
});
