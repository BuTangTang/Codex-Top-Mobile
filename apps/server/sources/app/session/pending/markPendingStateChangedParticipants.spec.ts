import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    markSessionParticipantsChanged: vi.fn(async () => []),
}));

vi.mock("@/app/session/changeTracking/markSessionParticipantsChanged", () => ({
    markSessionParticipantsChanged: mocks.markSessionParticipantsChanged,
}));

import { markPendingStateChangedParticipants } from "./markPendingStateChangedParticipants";

describe("markPendingStateChangedParticipants", () => {
    beforeEach(() => {
        mocks.markSessionParticipantsChanged.mockClear();
    });

    it("adds exact meaningfulActivityAt to the session change hint when provided", async () => {
        const meaningfulActivityAt = new Date("2026-06-01T12:00:00.000Z");
        const tx = {} as Parameters<typeof markPendingStateChangedParticipants>[0]["tx"];

        await markPendingStateChangedParticipants({
            tx,
            sessionId: "s1",
            pendingCount: 1,
            pendingVersion: 3,
            meaningfulActivityAt,
        });

        expect(mocks.markSessionParticipantsChanged).toHaveBeenCalledWith({
            tx,
            sessionId: "s1",
            hint: {
                pendingCount: 1,
                pendingVersion: 3,
                meaningfulActivityAt: meaningfulActivityAt.getTime(),
            },
        });
    });
});
