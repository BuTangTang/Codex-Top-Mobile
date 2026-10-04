# ONNX Runtime loader fixture

`onnxruntime-node-1.21.0-binding.cjs` is the unmodified `dist/binding.js`
from the published `onnxruntime-node` npm package, version **1.21.0**.
It was copied from the canonical CLI payload's Transformers dependency tree;
only the fixture filename differs. Tests read its bytes to recognize the audited
platform loader; they do not execute it or load native binaries.

- Package: <https://www.npmjs.com/package/onnxruntime-node/v/1.21.0>
- Upstream: <https://github.com/microsoft/onnxruntime/tree/v1.21.0>
- SHA-256: `266a182fa5802f8f76c93979663eb572e0164577f4f59bd70bbb92c4accb83aa`
- License: MIT, Copyright (c) Microsoft Corporation. The complete notice is in
  `onnxruntime-node-1.21.0-LICENSE.txt`, copied verbatim from
  <https://raw.githubusercontent.com/microsoft/onnxruntime/v1.21.0/LICENSE>.

The native bindings, runtime libraries, and other package files created by these
tests are synthetic fixtures, not redistributed runtime binaries.
