import Fastify from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";

import { computeAccountActivityBadgeCounts } from "@/app/activity/accountActivityBadge";
import { auth } from "@/app/auth/auth";
import { enableAuthentication } from "@/app/api/utils/enableAuthentication";
import { sessionRoutes } from "./sessionRoutes";
import { createAppCloseTracker } from "../../testkit/appLifecycle";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { db } from "@/storage/db";

const { trackApp, closeTrackedApps } = createAppCloseTracker();

function createTestApp() {
    const app = Fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Test harness bridge: route helpers use the app-local Fastify alias with auth decorations.
    const typed = app.withTypeProvider<ZodTypeProvider>() as any;
    enableAuthentication(typed);
    sessionRoutes(typed);
    return trackApp(typed);
}

describe("sessionRoutes system records (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({
            tempDirPrefix: "happier-session-system-records-",
            initAuth: true,
            initEncrypt: true,
        });
    }, 120_000);

    afterEach(async () => {
        await closeTrackedApps();
        harness.resetEnv();
        vi.unstubAllGlobals();
        await db.sessionSystemRecord.deleteMany();
        await db.sessionMessage.deleteMany();
        await db.sessionShare.deleteMany();
        await db.session.deleteMany();
        await db.account.deleteMany();
    });

    afterAll(async () => {
        await harness.close();
    });

    it("stores records outside the transcript without changing session activity or unread badges", async () => {
        const app = createTestApp();
        const account = await db.account.create({ data: { publicKey: "pk-system-record-owner" } });
        const sharedAccount = await db.account.create({ data: { publicKey: "pk-system-record-shared" } });
        const token = await auth.createToken(account.id);
        const sharedToken = await auth.createToken(sharedAccount.id);
        const meaningfulActivityAt = new Date("2026-05-19T09:00:00.000Z");
        const session = await db.session.create({
            data: {
                accountId: account.id,
                tag: "system-record-session",
                encryptionMode: "e2ee",
                metadata: "ciphertext",
                metadataVersion: 1,
                agentState: null,
                agentStateVersion: 0,
                seq: 7,
                lastViewedSessionSeq: 7,
                meaningfulActivityAt,
                pendingVersion: 0,
                pendingCount: 0,
                active: true,
                shares: {
                    create: {
                        sharedByUserId: account.id,
                        sharedWithUserId: sharedAccount.id,
                        accessLevel: "view",
                    },
                },
            },
            select: { id: true, seq: true, meaningfulActivityAt: true },
        });
        const badgeCountsBefore = await computeAccountActivityBadgeCounts([account.id]);

        const upsert = await app.inject({
            method: "PUT",
            url: `/v2/sessions/${session.id}/system-records`,
            headers: { authorization: `Bearer ${token}` },
            payload: {
                namespace: "memory",
                kind: "summary_shard.v1",
                localId: "memory:summary_shard:v1:1-7",
                content: { t: "encrypted", c: "cipher" },
            },
        });

        expect(upsert.statusCode).toBe(200);
        expect(upsert.json()).toMatchObject({
            didCreate: true,
            didUpdate: false,
            record: {
                sessionId: session.id,
                namespace: "memory",
                kind: "summary_shard.v1",
                localId: "memory:summary_shard:v1:1-7",
                content: { t: "encrypted", c: "cipher" },
            },
        });

        const storedSession = await db.session.findUniqueOrThrow({
            where: { id: session.id },
            select: { seq: true, meaningfulActivityAt: true, lastViewedSessionSeq: true },
        });
        expect(storedSession).toEqual({
            seq: 7,
            meaningfulActivityAt,
            lastViewedSessionSeq: 7,
        });
        await expect(db.sessionMessage.count({ where: { sessionId: session.id } })).resolves.toBe(0);
        await expect(db.accountChange.count({ where: { accountId: account.id, kind: "session", entityId: session.id } })).resolves.toBe(0);
        await expect(computeAccountActivityBadgeCounts([account.id])).resolves.toEqual(badgeCountsBefore);

        const messages = await app.inject({
            method: "GET",
            url: `/v1/sessions/${session.id}/messages`,
            headers: { authorization: `Bearer ${token}` },
        });
        expect(messages.statusCode).toBe(200);
        expect(messages.json()).toMatchObject({ messages: [] });

        const sharedList = await app.inject({
            method: "GET",
            url: `/v2/sessions/${session.id}/system-records?namespace=memory&kind=summary_shard.v1`,
            headers: { authorization: `Bearer ${sharedToken}` },
        });
        expect(sharedList.statusCode).toBe(200);
        expect(sharedList.json()).toEqual({ records: [], nextCursor: null, hasNext: false });

        const sharedUpsert = await app.inject({
            method: "PUT",
            url: `/v2/sessions/${session.id}/system-records`,
            headers: { authorization: `Bearer ${sharedToken}` },
            payload: {
                namespace: "memory",
                kind: "summary_shard.v1",
                localId: "memory:summary_shard:v1:viewer",
                content: { t: "encrypted", c: "viewer-cipher" },
            },
        });

        expect(sharedUpsert.statusCode).toBe(403);
        await expect(db.sessionSystemRecord.count({
            where: {
                accountId: sharedAccount.id,
                sessionId: session.id,
            },
        })).resolves.toBe(0);
    }, 120_000);
});
