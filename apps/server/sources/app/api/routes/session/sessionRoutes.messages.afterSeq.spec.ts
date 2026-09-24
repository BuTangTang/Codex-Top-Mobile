import { beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";

import {
    catchupFetchesInc,
    catchupReturnedInc,
    checkSessionAccess,
    createSessionRouteTestBuilder,
    resetSessionRouteMocks,
    sessionMessageFindMany,
} from "./sessionRoutes.testkit";

describe("sessionRoutes v1 messages pagination", () => {
    beforeEach(() => {
        resetSessionRouteMocks();
        checkSessionAccess.mockReset();
        sessionMessageFindMany.mockReset();
        catchupFetchesInc.mockReset();
        catchupReturnedInc.mockReset();
    });

    it("returns forward page in ascending order with nextAfterSeq when hasMore", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m3", seq: 3, localId: null, sidechainId: null, messageRole: "user", content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
            { id: "m4", seq: 4, localId: null, sidechainId: null, messageRole: "user", content: { t: "encrypted", c: "c4" }, createdAt: t0, updatedAt: t0 },
            { id: "m5", seq: 5, localId: null, sidechainId: null, messageRole: "user", content: { t: "encrypted", c: "c5" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { afterSeq: 2, limit: 2, role: "user" },
        });

        expect(catchupFetchesInc).toHaveBeenCalledWith({ type: "session-messages-afterSeq" });
        expect(catchupReturnedInc).toHaveBeenCalledWith({ type: "session-messages-afterSeq" }, 2);

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: null,
                    OR: [{ messageRole: "user" }, { messageRole: null }],
                    seq: { gt: 2 },
                },
                orderBy: { seq: "asc" },
                take: 3,
            }),
        );

        expect(res).toEqual({
            messages: [
                { id: "m3", seq: 3, content: { t: "encrypted", c: "c3" }, localId: null, messageRole: "user", createdAt: 1, updatedAt: 1 },
                { id: "m4", seq: 4, content: { t: "encrypted", c: "c4" }, localId: null, messageRole: "user", createdAt: 1, updatedAt: 1 },
            ],
            hasMore: true,
            nextBeforeSeq: null,
            nextAfterSeq: 4,
        });
    });

    it("includes legacy null-role rows in user role filters for encrypted history recovery", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        await route.invoke({
            params: { sessionId: "s1" },
            query: { role: "user", limit: 50 },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: null,
                    OR: [{ messageRole: "user" }, { messageRole: null }],
                },
            }),
        );
    });

    it("rejects unsupported role filters", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { reply } = await route.invoke({
            params: { sessionId: "s1" },
            query: { role: "tool" },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(sessionMessageFindMany).not.toHaveBeenCalled();
    });

    it("filters by CSV roles using a multi-role query", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m4", seq: 4, localId: null, sidechainId: null, messageRole: "agent", content: { t: "encrypted", c: "c4" }, createdAt: t0, updatedAt: t0 },
            { id: "m3", seq: 3, localId: null, sidechainId: null, messageRole: "user", content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 2, roles: "user,agent" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: null,
                    OR: [{ messageRole: { in: ["user", "agent"] } }, { messageRole: null }],
                },
                take: 3,
            }),
        );

        expect(res).toMatchObject({
            messages: [
                { id: "m4", seq: 4, content: { t: "encrypted", c: "c4" }, localId: null, messageRole: "agent", createdAt: 1, updatedAt: 1 },
                { id: "m3", seq: 3, content: { t: "encrypted", c: "c3" }, localId: null, messageRole: "user", createdAt: 1, updatedAt: 1 },
            ],
        });
    });

    it("filters by CSV roles with beforeSeq using backward paging", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m4", seq: 4, localId: null, sidechainId: null, messageRole: "agent", content: { t: "encrypted", c: "c4" }, createdAt: t0, updatedAt: t0 },
            { id: "m3", seq: 3, localId: null, sidechainId: null, messageRole: "user", content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { beforeSeq: 5, limit: 2, roles: "user,agent" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: null,
                    OR: [{ messageRole: { in: ["user", "agent"] } }, { messageRole: null }],
                    seq: { lt: 5 },
                },
                orderBy: { seq: "desc" },
                take: 3,
            }),
        );

        expect(res).toMatchObject({
            messages: [
                { id: "m4", seq: 4, messageRole: "agent" },
                { id: "m3", seq: 3, messageRole: "user" },
            ],
        });
    });

    it("unions singular role with CSV roles and dedupes them", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        await route.invoke({
            params: { sessionId: "s1" },
            query: { role: "user", roles: "agent,user,event" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: null,
                    OR: [{ messageRole: { in: ["user", "agent", "event"] } }, { messageRole: null }],
                },
            }),
        );
    });

    it("rejects invalid CSV role values without widening the query", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { reply } = await route.invoke({
            params: { sessionId: "s1" },
            query: { roles: "user,tool" },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(sessionMessageFindMany).not.toHaveBeenCalled();
    });

    it("rejects repeated role query params as arrays instead of widening the query", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { reply } = await route.invoke({
            params: { sessionId: "s1" },
            query: { role: ["user", "agent"] },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(sessionMessageFindMany).not.toHaveBeenCalled();
    });

    it("documents Fastify repeated role query params as arrays", async () => {
        const app = Fastify({ logger: false });
        app.get("/query", async (request) => request.query);
        await app.ready();
        try {
            const res = await app.inject("/query?role=user&role=agent&roles=user&roles=agent");
            expect(res.json()).toEqual({ role: ["user", "agent"], roles: ["user", "agent"] });
        } finally {
            await app.close();
        }
    });

    it("rejects repeated roles query params as arrays instead of widening the query", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { reply } = await route.invoke({
            params: { sessionId: "s1" },
            query: { roles: ["user", "agent"] },
        });

        expect(reply.code).toHaveBeenCalledWith(400);
        expect(sessionMessageFindMany).not.toHaveBeenCalled();
    });

    it("returns nextAfterSeq=null when forward page has no more", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m3", seq: 3, localId: null, sidechainId: null, content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { afterSeq: 2, limit: 2 },
        });

        expect(catchupFetchesInc).toHaveBeenCalledWith({ type: "session-messages-afterSeq" });
        expect(catchupReturnedInc).toHaveBeenCalledWith({ type: "session-messages-afterSeq" }, 1);

        expect(res).toEqual({
            messages: [
                { id: "m3", seq: 3, content: { t: "encrypted", c: "c3" }, localId: null, createdAt: 1, updatedAt: 1 },
            ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
        });
    });

    it("keeps legacy default behavior (backward paging newest-first) when afterSeq is not provided", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m5", seq: 5, localId: null, sidechainId: null, content: { t: "encrypted", c: "c5" }, createdAt: t0, updatedAt: t0 },
            { id: "m4", seq: 4, localId: null, sidechainId: null, content: { t: "encrypted", c: "c4" }, createdAt: t0, updatedAt: t0 },
            { id: "m3", seq: 3, localId: null, sidechainId: null, content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 2 },
        });

        expect(catchupFetchesInc).not.toHaveBeenCalled();
        expect(catchupReturnedInc).not.toHaveBeenCalled();

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1", sidechainId: null },
                orderBy: { seq: "desc" },
                take: 3,
            }),
        );

        expect(res).toEqual({
            messages: [
                { id: "m5", seq: 5, content: { t: "encrypted", c: "c5" }, localId: null, createdAt: 1, updatedAt: 1 },
                { id: "m4", seq: 4, content: { t: "encrypted", c: "c4" }, localId: null, createdAt: 1, updatedAt: 1 },
            ],
            hasMore: true,
            nextBeforeSeq: 4,
            nextAfterSeq: null,
        });
    });

    it("keeps legacy beforeSeq behavior when afterSeq is not provided", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m4", seq: 4, localId: null, sidechainId: null, content: { t: "encrypted", c: "c4" }, createdAt: t0, updatedAt: t0 },
            { id: "m3", seq: 3, localId: null, sidechainId: null, content: { t: "encrypted", c: "c3" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { beforeSeq: 5, limit: 50 },
        });

        expect(catchupFetchesInc).not.toHaveBeenCalled();
        expect(catchupReturnedInc).not.toHaveBeenCalled();

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1", sidechainId: null, seq: { lt: 5 } },
                orderBy: { seq: "desc" },
                take: 51,
            }),
        );

        expect(res).toEqual({
            messages: [
                { id: "m4", seq: 4, content: { t: "encrypted", c: "c4" }, localId: null, createdAt: 1, updatedAt: 1 },
                { id: "m3", seq: 3, content: { t: "encrypted", c: "c3" }, localId: null, createdAt: 1, updatedAt: 1 },
            ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
        });
    });

    it("can fetch all chains when scope=all", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m2", seq: 2, localId: null, sidechainId: "sc-1", content: { t: "encrypted", c: "c2" }, createdAt: t0, updatedAt: t0 },
            { id: "m1", seq: 1, localId: null, sidechainId: null, content: { t: "encrypted", c: "c1" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50, scope: "all" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1" },
            }),
        );

        expect(res).toEqual({
            messages: [
                { id: "m2", seq: 2, content: { t: "encrypted", c: "c2" }, localId: null, sidechainId: "sc-1", createdAt: 1, updatedAt: 1 },
                { id: "m1", seq: 1, content: { t: "encrypted", c: "c1" }, localId: null, createdAt: 1, updatedAt: 1 },
            ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
        });
    });

    it("can role-filter all chains when scope=all", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50, scope: "all", roles: "user,agent" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    OR: [{ messageRole: { in: ["user", "agent"] } }, { messageRole: null }],
                },
            }),
        );
    });

    it("can fetch a single sidechain when scope=sidechain", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m2", seq: 2, localId: null, sidechainId: "sc-1", content: { t: "encrypted", c: "c2" }, createdAt: t0, updatedAt: t0 },
            { id: "m1", seq: 1, localId: null, sidechainId: "sc-1", content: { t: "encrypted", c: "c1" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50, scope: "sidechain", sidechainId: "sc-1" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1", sidechainId: "sc-1" },
            }),
        );
    });

    it("can role-filter a single sidechain when scope=sidechain", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });
        sessionMessageFindMany.mockResolvedValue([]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50, scope: "sidechain", sidechainId: "sc-1", roles: "user,agent" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    sessionId: "s1",
                    sidechainId: "sc-1",
                    OR: [{ messageRole: { in: ["user", "agent"] } }, { messageRole: null }],
                },
            }),
        );
    });

    it("can filter unknown role rows explicitly", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m2", seq: 2, localId: null, sidechainId: null, messageRole: "unknown", content: { t: "encrypted", c: "c2" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50, role: "unknown" },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1", sidechainId: null, messageRole: "unknown" },
            }),
        );
        expect(res).toEqual({
            messages: [
                { id: "m2", seq: 2, content: { t: "encrypted", c: "c2" }, localId: null, messageRole: "unknown", createdAt: 1, updatedAt: 1 },
            ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
        });
    });

    it("returns legacy null role rows without a messageRole field when unfiltered", async () => {
        checkSessionAccess.mockResolvedValue({ level: "owner" });

        const t0 = new Date(1);
        sessionMessageFindMany.mockResolvedValue([
            { id: "m2", seq: 2, localId: null, sidechainId: null, messageRole: null, content: { t: "encrypted", c: "c2" }, createdAt: t0, updatedAt: t0 },
        ]);

        const route = await createSessionRouteTestBuilder("GET", "/v1/sessions/:sessionId/messages");
        const { response: res } = await route.invoke({
            params: { sessionId: "s1" },
            query: { limit: 50 },
        });

        expect(sessionMessageFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { sessionId: "s1", sidechainId: null },
            }),
        );
        expect(res).toEqual({
            messages: [
                { id: "m2", seq: 2, content: { t: "encrypted", c: "c2" }, localId: null, createdAt: 1, updatedAt: 1 },
            ],
            hasMore: false,
            nextBeforeSeq: null,
            nextAfterSeq: null,
        });
    });
});
