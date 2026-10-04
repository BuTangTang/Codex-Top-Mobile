# Codex Top runtime profile

The `codex-top` artifact profile packages the existing CLI owners for the native macOS application. The default `happier` profile remains the default and retains its backend catalog, commands, memory and session tools.

## Product boundary

The product entry exposes `auth`, `daemon` and `codex`. Its static catalog contains Codex; malformed, unknown and unsupported backend targets are rejected before normalization can turn them into the default backend. Account or environment configuration cannot enable capabilities excluded from this profile. Memory actions are disabled in both CLI and MCP enablement projections. Session send, follow, takeover, stop and attachment handlers continue using their existing implementation.

Product capabilities are selected by four build aliases in `CODEX_TOP_ARTIFACT_PROFILE`, not by a runtime environment toggle. The default entry and registry continue through the same shared bootstrap and lifecycle owners.

## Artifact and launch

The currently validated target is `darwin-arm64`. The canonical component builder accepts `artifactProfile: 'codex-top'`, uses the existing CLI build lock and immutable source snapshot, then publishes a complete staged payload. A failed generation preserves the previous payload; failed replacement restores it.

The payload contains one signed Bun runtime, split product JavaScript, three MCP bridge entries, the retained scripts and current-platform Sharp/PTY resources. The self-relative wrapper uses a physical directory and `exec`, retaining arguments, working directory, standard input and cancellation identity. Managed subprocess and daemon launch resolution requires the same physical runtime and the existing `runtimeAsset` receipt. It does not fetch another runtime or fall back to a user-directory installation.

The source fingerprint covers actual bundle inputs and their package scopes, configuration, lockfile, build script, profile, version, target and Bun version/revision/bytes/hash. Random snapshot directory names are normalized. This is a bundle-input fingerprint; runtime resources additionally require artifact integrity and application signature verification.

Native assets are copied from a validated explicit closure rather than a complete dependency/vendor tree. Retained package metadata and available licenses accompany the payload. A package without a supplied license text is recorded as such; no license text is invented. Only the packaged PTY spawn helper receives the required executable mode; source permissions are unchanged.

On the macOS Bun product path, the existing PTY provider uses Bun’s built-in terminal API. The normal Node provider remains unchanged. The adapter preserves UTF-8 chunk boundaries, controls and disposable event listeners, and distinguishes terminal stream closure from the actual child exit status. Unsupported binary or flow-control modes fail explicitly; current product callers use UTF-8 without software flow control.

## Validation boundaries

Focused source tests cover registry and command composition, capability projection, default-path preservation, immutable generation and replacement rollback, exact native resources, bundle-input fingerprints, and managed child/daemon layout. Explicit real-Bun integration tests exercise product aliases and reject a bundle retaining excluded tools.

A release also requires a relocated complete app with an empty PATH and temporary account directories, real image processing and PTY owner probes, signature checks, account/machine identity readback, one real GUI/daemon instance and resource measurement with the circle visible and settings closed. Source tests and artifact size alone do not establish phone delivery performance. Native app deployment results are recorded in the Codex Top repository’s resource validation document.
