# @happier-dev/cli-common

Internal shared utilities for Happier CLIs (`@happier-dev/cli` and `@happier-dev/stack`).

This package is **private** and is bundled into published artifacts via `bundledDependencies`.

CLI binary artifacts keep the runtime dependency closure. After vendoring and before
finalization, the builder removes non-target operating-system binaries from the
verified `onnxruntime-node` 1.21.0 layout nested under Transformers. It preserves
every architecture and library for the target OS. Package metadata, loader bytes
and layout must match the known version; unknown versions/layouts remain intact,
and symlinks are rejected before any deletion. This is artifact-only pruning:
workspace dependencies and runtime feature selection are unchanged.

The platform-pruning tests exercise the production artifact builder with synthetic
dependencies and verify retained file hashes. A release still needs native-import
and application checks for its target OS; fixture success does not establish that
the complete Transformers module or a model can load.
