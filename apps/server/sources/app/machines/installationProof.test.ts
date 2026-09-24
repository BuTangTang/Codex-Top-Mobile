import { describe, expect, it } from "vitest";
import tweetnacl from "tweetnacl";
import {
    computeContentPublicKeyFingerprint as computeProtocolContentPublicKeyFingerprint,
    encodeBase64,
    signMachineInstallationProof,
} from "@happier-dev/protocol";

import {
    computeContentPublicKeyFingerprint,
    verifyMachineInstallationRegistration,
} from "./installationProof";

describe("machine installation proof verification", () => {
    it("uses the protocol content public key fingerprint format", () => {
        const contentPublicKey = new Uint8Array(tweetnacl.box.publicKeyLength);
        contentPublicKey[0] = 42;

        expect(computeContentPublicKeyFingerprint(contentPublicKey)).toBe(
            computeProtocolContentPublicKeyFingerprint(contentPublicKey),
        );
    });

    it("accepts protocol installation proofs with replacement intent and content key fingerprint", () => {
        const installationKeyPair = tweetnacl.sign.keyPair();
        const contentPublicKey = new Uint8Array(tweetnacl.box.publicKeyLength);
        contentPublicKey[0] = 9;
        const contentPublicKeyFingerprint = computeProtocolContentPublicKeyFingerprint(contentPublicKey);
        const payload = {
            version: 1 as const,
            installationId: "installation-1",
            machineId: "machine-new",
            replacesMachineId: "machine-old",
            replacementReason: "reauth",
            contentPublicKeyFingerprint,
            accountId: "account-1",
        };

        const result = verifyMachineInstallationRegistration({
            accountId: "account-1",
            machineId: "machine-new",
            installationId: "installation-1",
            installationPublicKey: encodeBase64(installationKeyPair.publicKey, "base64url"),
            installationProof: signMachineInstallationProof({
                payload,
                privateKey: installationKeyPair.secretKey,
            }),
            replacesMachineId: "machine-old",
            replacementReason: "reauth",
            contentPublicKeyFingerprint,
        });

        expect(result).toEqual({
            ok: true,
            identity: {
                installationId: "installation-1",
                installationPublicKey: installationKeyPair.publicKey,
                contentPublicKeyFingerprint,
                replacesMachineId: "machine-old",
            },
        });
    });

    it("rejects malformed content public key fingerprints without throwing", () => {
        const installationKeyPair = tweetnacl.sign.keyPair();

        const result = verifyMachineInstallationRegistration({
            accountId: "account-1",
            machineId: "machine-new",
            installationId: "installation-1",
            installationPublicKey: encodeBase64(installationKeyPair.publicKey, "base64url"),
            installationProof: {
                version: 1,
                algorithm: "ed25519",
                signature: encodeBase64(new Uint8Array(tweetnacl.sign.signatureLength), "base64url"),
            },
            replacesMachineId: "machine-old",
            replacementReason: "reauth",
            contentPublicKeyFingerprint: "sha256:not-valid",
        });

        expect(result).toEqual({ ok: false, reason: "content_public_key_fingerprint_invalid" });
    });
});
