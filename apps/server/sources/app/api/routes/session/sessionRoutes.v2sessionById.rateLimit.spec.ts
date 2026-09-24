import { describe, expect, it } from "vitest";

import { createFakeRouteApp, getRouteEntry } from "../../testkit/routeHarness";

describe("sessionRoutes v2 session detail rate limit", () => {
    it("registers GET /v2/sessions/:sessionId with an explicit rate limit", async () => {
        const { registerSessionListingRoutes } = await import("./registerSessionListingRoutes");
        const app = createFakeRouteApp();

        registerSessionListingRoutes(app as any);

        expect(getRouteEntry(app, "GET", "/v2/sessions/:sessionId").opts.config?.rateLimit).toEqual(
            expect.objectContaining({ max: expect.any(Number), timeWindow: expect.any(String) }),
        );
    }, 60_000);
});
