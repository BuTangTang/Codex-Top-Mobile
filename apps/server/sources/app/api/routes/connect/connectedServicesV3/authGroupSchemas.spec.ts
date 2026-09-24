import { describe, expect, it } from "vitest";

import {
    ActiveProfileBodySchema,
    AuthGroupErrorResponseSchema,
    AuthGroupMemberInputSchema,
    DeleteAuthGroupMemberQuerySchema,
    UpdateAuthGroupMemberBodySchema,
    UpdateAuthGroupBodySchema,
} from "./authGroupSchemas";

describe("connected service auth group route schemas", () => {
    it("lets generation-sensitive omissions reach route handlers for typed error responses", () => {
        expect(AuthGroupMemberInputSchema.safeParse({
            profileId: "profile-a",
        }).success).toBe(true);

        expect(UpdateAuthGroupMemberBodySchema.safeParse({
            enabled: true,
        }).success).toBe(true);

        expect(DeleteAuthGroupMemberQuerySchema.safeParse({}).success).toBe(true);

        expect(ActiveProfileBodySchema.safeParse({
            profileId: "profile-a",
        }).success).toBe(true);

        // Generic group PATCH generation errors are returned by the route handler so
        // callers receive the typed connect_group_generation_required response.
        expect(UpdateAuthGroupBodySchema.safeParse({
            activeProfileId: "profile-a",
        }).success).toBe(true);
        expect(UpdateAuthGroupBodySchema.safeParse({
            policy: { autoSwitch: false },
        }).success).toBe(true);
    });

    it("accepts expectedGeneration for generation-sensitive member, active-profile, and policy mutations", () => {
        expect(AuthGroupMemberInputSchema.safeParse({
            profileId: "profile-a",
            expectedGeneration: 1,
        }).success).toBe(true);

        expect(UpdateAuthGroupMemberBodySchema.safeParse({
            enabled: true,
            expectedGeneration: 1,
        }).success).toBe(true);

        expect(DeleteAuthGroupMemberQuerySchema.safeParse({
            expectedGeneration: "1",
        }).success).toBe(true);

        expect(ActiveProfileBodySchema.safeParse({
            profileId: "profile-a",
            expectedGeneration: 1,
            overrideRuntimeCooldown: true,
        }).success).toBe(true);

        expect(UpdateAuthGroupBodySchema.safeParse({
            activeProfileId: "profile-a",
            expectedGeneration: 1,
            overrideRuntimeCooldown: true,
        }).success).toBe(true);

        expect(UpdateAuthGroupBodySchema.safeParse({
            policy: { autoSwitch: false },
            expectedGeneration: 1,
        }).success).toBe(true);

        expect(UpdateAuthGroupBodySchema.safeParse({
            displayName: "Team fallback",
        }).success).toBe(true);
    });

    it("accepts the typed unsupported-runtime fallback error response", () => {
        expect(AuthGroupErrorResponseSchema.safeParse({
            error: "connect_group_runtime_fallback_unsupported",
        }).success).toBe(true);
    });
});
