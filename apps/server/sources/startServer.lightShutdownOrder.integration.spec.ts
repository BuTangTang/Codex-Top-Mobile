import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    createStartServerDbMocks,
    installStartServerDbModuleMock,
    installStartServerCommonWiringMocks,
} from "@/testkit/startServerMocks";
import { createStartServerHarness } from "@/testkit/startServerHarness";

const callOrder: string[] = [];

const dbDisconnect = vi.fn(async () => {
    callOrder.push("db.$disconnect");
});

const shutdownDbPglite = vi.fn(async () => {
    callOrder.push("shutdownDbPglite");
});
const startServerDbMocks = createStartServerDbMocks({
    getDbProviderFromEnv: () => "pglite",
});
startServerDbMocks.dbDisconnect.mockImplementation(dbDisconnect);
startServerDbMocks.shutdownDbPglite.mockImplementation(shutdownDbPglite);

installStartServerDbModuleMock(startServerDbMocks);

installStartServerCommonWiringMocks();

// Avoid hanging in tests: startServer calls awaitShutdown().
vi.mock("@/utils/process/shutdown", async () => {
    const actual = await vi.importActual<any>("@/utils/process/shutdown");
    return { ...actual, awaitShutdown: vi.fn(async () => {}) };
});

describe("startServer light shutdown ordering", () => {
    const startServerHarness = createStartServerHarness();

    beforeEach(() => {
        startServerDbMocks.reset();
        startServerDbMocks.dbDisconnect.mockImplementation(dbDisconnect);
        startServerDbMocks.shutdownDbPglite.mockImplementation(shutdownDbPglite);
        startServerHarness.reset();
    });

    afterEach(() => {
        startServerHarness.restore();
    });

    it("flushes the activity cache before disconnecting Prisma and stopping pglite", async () => {
        callOrder.length = 0;
        startServerHarness.prepareImport({
            SERVER_ROLE: "all",
            REDIS_URL: undefined,
        });

        let resolveActivityCacheShutdown: () => void = () => {
            throw new Error("resolveActivityCacheShutdown not initialized");
        };
        const activityCacheShutdownBarrier = new Promise<void>((resolve) => {
            resolveActivityCacheShutdown = () => resolve();
        });
        const { activityCache } = await import("@/app/presence/sessionCache");
        vi.mocked(activityCache.shutdown).mockImplementation(async () => {
            callOrder.push("activityCache.shutdown:start");
            await activityCacheShutdownBarrier;
            callOrder.push("activityCache.shutdown:done");
        });

        const { startServer } = await import("./startServer");
        const { initiateShutdown } = await import("@/utils/process/shutdown");

        await startServer("light");
        const shutdownPromise = initiateShutdown("test");

        await Promise.resolve();
        resolveActivityCacheShutdown();
        await shutdownPromise;

        expect(callOrder).toEqual([
            "activityCache.shutdown:start",
            "activityCache.shutdown:done",
            "db.$disconnect",
            "shutdownDbPglite",
        ]);
    });
});
