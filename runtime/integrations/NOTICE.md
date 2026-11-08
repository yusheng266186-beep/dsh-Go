# Personal DSH Go integration

This branch adds only dsh-purge Community and CodeBuddy connectivity.

- dsh-purge Community 1.6.84: kingcharleslzy-ai/dsh-purge, based on
  YuJunZhiXue/dsh-purge, MIT. The unmodified release archive is pinned by URL
  and npm integrity. Its SHA-256 is
  `1742daa8d9fbbe6f3cc4469b09a80ca0c8fc8e4b3b0e1272f4692f47f4d7aee4`.
  Its package carries its original license, notices, UI and apply/revert tools.
  The bundled red-team preset resolver locates the pinned tool module by its
  package path. This supports Android installations without profile dependencies.
- `codebuddy.cjs` derives from DSH-Native commit
  `a299db558fbc1acf374a65f63a5bed79a3e35be9`, MIT; see CODEBUDDY-LICENSE.
  Changes: load the npm-pinned SDK from the runtime, keep CLI state under
  DSH_HOME, disable standby processes, and append concise host-tool instructions
  for chats to the official SDK persona. Explicit non-chat prompts are preserved.
- Official `@tencent-ai/agent-sdk` 0.3.291 is installed without modifying its
  runtime files. DSH executes host tools; the CLI's built-in tools are disabled.
  Catalog refresh creates a fresh SDK metadata session and calls
  getAvailableModelsRaw(); it does not send a generation prompt or use a fixed
  model table. Live thinking levels, images and token limits are mapped into
  the real DSH provider configuration. Missing token limits fail the refresh
  and preserve the saved catalog. Successful metadata discovery does not prove
  that every listed model accepts a paid generation request.

The original DSH Go remains ccch1mneyyy/dsh-Go (AGPL-3.0). This is an independent
personal branch, not an upstream release. Upstream brand/artwork conditions in
ASSETS.md continue to apply.
