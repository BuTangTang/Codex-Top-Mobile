import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "prom-client";

vi.mock("@/storage/db", () => ({
    db: {},
}));

vi.mock("@/utils/runtime/forever", () => ({
    forever: vi.fn(),
}));

vi.mock("@/utils/runtime/delay", () => ({
    delay: vi.fn(),
}));

vi.mock("@/utils/process/shutdown", () => ({
    shutdownSignal: undefined,
}));

function importDuplicateMetricsModule(path: string): Promise<unknown> {
    return import(/* @vite-ignore */ path);
}

describe("metrics2 registry", () => {
    afterEach(() => {
        register.clear();
    });

    it("reuses already-registered metrics when the module is evaluated more than once", async () => {
        register.clear();

        await import("./metrics2");

        await expect(importDuplicateMetricsModule("./metrics2?duplicate-registration")).resolves.toBeDefined();
        expect(register.getSingleMetric("websocket_connections_total")).toBeDefined();
    });
});
