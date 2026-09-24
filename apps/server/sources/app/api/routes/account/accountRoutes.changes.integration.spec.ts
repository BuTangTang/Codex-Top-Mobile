import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { accountRoutes } from "./accountRoutes";

const { emitUpdate, buildUpdateAccountUpdate, buildAccountSettingsChangedUpdate, randomKeyNaked, markAccountChanged } = vi.hoisted(() => ({
    emitUpdate: vi.fn(),
    buildUpdateAccountUpdate: vi.fn((_userId: string, _profile: any, updSeq: number, updId: string) => ({
        id: updId,
        seq: updSeq,
        body: { t: "update-account" },
    })),
    buildAccountSettingsChangedUpdate: vi.fn((_settingsVersion: number, updSeq: number, updId: string) => ({
        id: updId,
        seq: updSeq,
        body: { t: "account-settings-changed", settingsVersion: _settingsVersion },
        createdAt: 0,
    })),
    randomKeyNaked: vi.fn(() => "upd-id"),
    markAccountChanged: vi.fn(async () => 444),
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: { emitUpdate },
    buildUpdateAccountUpdate,
    buildAccountSettingsChangedUpdate,
}));

vi.mock("@/utils/keys/randomKeyNaked", () => ({ randomKeyNaked }));

vi.mock("@/app/changes/markAccountChanged", () => ({ markAccountChanged }));

vi.mock("@/utils/logging/log", () => ({ log: vi.fn() }));

describe("accountRoutes (AccountChange integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-account-changes-", initAuth: false });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        harness.resetEnv();
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.accountChange.deleteMany(),
            () => db.repeatKey.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    it("marks v1 account settings change and emits user update plus compact daemon hint using returned cursor", async () => {
        const account = await db.account.create({
            data: {
                publicKey: "pub",
                encryptionMode: "e2ee",
                settings: "old",
                settingsVersion: 1,
            },
            select: { id: true },
        });

        await withAuthenticatedTestApp(
            (app) => accountRoutes(app as any),
            async (app) => {
                const res = await app.inject({
                    method: "POST",
                    url: "/v1/account/settings",
                    headers: { "content-type": "application/json", "x-test-user-id": account.id },
                    payload: { settings: "new", expectedVersion: 1 },
                });

                expect(res.statusCode).toBe(200);
                expect(res.json()).toEqual({ success: true, version: 2 });
            },
        );

        const stored = await db.account.findUnique({
            where: { id: account.id },
            select: { settings: true, settingsVersion: true },
        });
        expect(stored).toEqual({ settings: "new", settingsVersion: 2 });

        expect(markAccountChanged).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ accountId: account.id, kind: "account", entityId: "self" }),
        );

        expect(emitUpdate).toHaveBeenCalledTimes(2);
        expect(emitUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: account.id,
                payload: expect.objectContaining({
                    seq: 444,
                    body: expect.objectContaining({ t: "update-account" }),
                }),
                recipientFilter: { type: "user-scoped-only" },
            }),
        );
        expect(emitUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: account.id,
                payload: expect.objectContaining({
                    seq: 444,
                    body: {
                        t: "account-settings-changed",
                        settingsVersion: 2,
                    },
                }),
                recipientFilter: { type: "user-machine-scoped-only" },
            }),
        );
        expect(buildAccountSettingsChangedUpdate).toHaveBeenCalledWith(2, 444, "upd-id");
    });

    it("marks v2 account settings change and emits compact daemon hint without settings content", async () => {
        const account = await db.account.create({
            data: {
                publicKey: "pub-v2",
                encryptionMode: "e2ee",
                settings: "old",
                settingsVersion: 1,
            },
            select: { id: true },
        });

        await withAuthenticatedTestApp(
            (app) => accountRoutes(app as any),
            async (app) => {
                const res = await app.inject({
                    method: "POST",
                    url: "/v2/account/settings",
                    headers: { "content-type": "application/json", "x-test-user-id": account.id },
                    payload: { content: { t: "encrypted", c: "new-v2" }, expectedVersion: 1 },
                });

                expect(res.statusCode).toBe(200);
                expect(res.json()).toEqual({ success: true, version: 2 });
            },
        );

        expect(buildUpdateAccountUpdate).toHaveBeenCalledWith(
            account.id,
            { settingsV2: { content: { t: "encrypted", c: "new-v2" }, version: 2 } },
            444,
            "upd-id",
        );
        expect(emitUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: account.id,
                payload: expect.objectContaining({
                    body: expect.objectContaining({ t: "update-account" }),
                }),
                recipientFilter: { type: "user-scoped-only" },
            }),
        );
        expect(emitUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: account.id,
                payload: expect.objectContaining({
                    body: {
                        t: "account-settings-changed",
                        settingsVersion: 2,
                    },
                }),
                recipientFilter: { type: "user-machine-scoped-only" },
            }),
        );
        const compactBody = buildAccountSettingsChangedUpdate.mock.results[0]?.value.body;
        expect(JSON.stringify(compactBody)).not.toContain("new-v2");
        expect(JSON.stringify(compactBody)).not.toContain("content");
        expect(JSON.stringify(compactBody)).not.toContain("settingsV2");
    });
});
