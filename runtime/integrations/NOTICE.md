# Personal DSH Go integration

This branch adds only dsh-purge Community and CodeBuddy connectivity.

- dsh-purge Community 1.7.20: kingcharleslzy-ai/dsh-purge, based on
  YuJunZhiXue/dsh-purge, MIT. The unmodified release archive is pinned by URL
  and npm integrity. Its SHA-256 is
  `5b3d66e804ea0b1cf6ef01035a292755ab9fea771b8f5338000954075dd6b45a`.
  Its package carries its original license, notices, UI and apply/revert tools.
  The bundled red-team preset resolver locates the pinned tool module by its
  package path. A fresh bundled Android profile is ready for conversation,
  with individual skills continuing to check their tool requirements.
  The pinned DSH runtime ports upstream patches #40 (preserve injections with
  complete presets) and #74 (prepare injections before prompt assembly).
  Complete presets also retain Purge's `dshpg-` capability sections. The
  retry adapter recognizes CodeBuddy channel, model-access and rate-limit
  failures so those requests settle without immediate Purge retries.
- `codebuddy.cjs` derives from DSH-Native commit
  `a299db558fbc1acf374a65f63a5bed79a3e35be9`, MIT; see CODEBUDDY-LICENSE.
  Changes: load the npm-pinned SDK from the runtime, keep CLI state under
  DSH_HOME, disable standby processes, and append concise host-tool instructions
  and the selected Purge preset sections for chats to the official SDK persona.
  Explicit non-chat prompts are preserved.
  DSH owns conversation compaction. Disposable CLI sessions disable their
  independent automatic compactor through the public settings option.
  Main chats keep a stable CLI conversation ID derived from their DSH session
  identity; auxiliary requests use independent CLI sessions.
- Official `@tencent-ai/agent-sdk` 0.3.305 is installed without modifying its
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

CodeBuddy follow-up: intercept SDK PreCompact overflow recovery so DSH owns all
checkpoints. The official CodeBuddy route trusts matching measured request usage
for compaction pressure instead of an estimate containing omitted reasoning.

The compaction patch can use the current model selection for summaries when a
previous model or provider was removed from configuration. Explicit summarizer
settings and failures unrelated to model removal retain their existing handling.

The Android personal edition now tracks dsh-Go v1.3.0 (da798027) and DSH
0.2.2-rc.5. OHOS retains the upstream rc.1 chain; renamed OHOS-only legacy
patches preserve that chain without applying Android rc.5 changes. The former
experimental Team roster is retired upstream; rc.5's task-DAG Team module is
used unchanged. The filesystem ENOTDIR fix is already in rc.5.

Model discovery codecs preserve reasoning metadata on both methods. Runtime
recipe hashes include integration sources. SDK/CLI generation, tool round trips,
large context, compaction ownership and cancellation are exercised with the real
official transport against a synthetic local provider. This does not establish
provider permission for every model or promise a particular model response.
