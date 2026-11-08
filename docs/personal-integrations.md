# Personal branch: Purge Community and CodeBuddy

[中文](personal-integrations.zh.md)

This independent branch of ccch1mneyyy/dsh-Go adds these two integrations only.
It is not an upstream release. Existing source, attribution and artwork terms apply.

## Purge Community

The runtime bundles MIT-licensed dsh-purge Community 1.6.84 from
kingcharleslzy-ai/dsh-purge, with a fixed release URL and npm integrity. Its prompt
injection, presets, web panel, status and rollback tools are included. Switch Go
to the official Web UI to use the Purge panel; plugin discovery lists the package.
The Android runtime registers Red Team and Unrestricted in the native new-chat
preset picker. Red Team resolves its tool entry inside the bundled runtime,
including when the preset already exists in a previous installation.
Fresh Android profiles can start a Red Team conversation with the built-in
runtime. Individual skills still report which optional tools they require.

The Android runtime includes Purge patches #40 and #74, which retain injected
sections with complete presets and prepare injections before the engine builds a
chat prompt. Both take effect when the local engine starts. Other host patches
retain their explicit Apply/Revert workflow. Runtime upgrades replace the host
tree and preserve existing Purge settings.

## CodeBuddy

1. Start the local engine. Open Settings → Models → Add provider.
2. Select **CodeBuddy**, paste your API key and choose **Fetch models**.
3. Select models, save and choose that CodeBuddy route in a conversation.
4. To refresh a saved route, open its details and choose **Fetch models**. This
   updates its saved model metadata and the chat picker.

The endpoint is `https://www.codebuddy.cn/v2`. Keys use Go's credential service
and Android secure storage. The visible OpenAI protocol describes configuration;
generation uses unmodified official Agent SDK 0.3.291 / CLI 2.176.0. DSH executes
tools. Regular chats use the SDK persona with concise host-tool instructions.
The serialized history explicitly continues the current user request, including
when DSH appends runtime context or a skill catalog after it.
This avoids forwarding the composed DSH system prompt that triggered 11128.
When Red Team or Unrestricted is selected, the transport also appends that
preset's persona and the active Purge injection sections. Explicit tasks such
as title generation keep their own prompt. The selected preset controls tools
and skills. The provider decides which requests it will answer.

Each directory fetch creates a fresh SDK metadata session and calls
`getAvailableModelsRaw()` without sending a generation prompt. There is no fixed
table or completed-result cache standing in for a refresh. Names, declared thinking levels, image
capability, context and output limits pass through discovery, persistence and the
actual model consumer. The selected context budget also reaches the official CLI.
On the official CodeBuddy route, a saved 300,000-token DeepSeek V4.1 Flash
window resolves to 1,000,000 for both DSH and the CLI at runtime.
No selected effort means the service default. Unknown vision does not enable
images. Missing token limits, empty results or errors fail the refresh and keep
the saved directory. Discovery does not prove paid generation access to every model.

CodeBuddy context-limit errors use DSH's automatic compaction and retry path.
The compactor sends a checkpoint task and history using a compatible prompt.
DSH owns automatic and manual compaction; the disposable CLI session's automatic
compactor is disabled. DSH normally starts at 80% of the declared context window,
or sooner if the output reservation and headroom require it. For a Hy4 route
declaring 960,000 tokens, the default 80% threshold is 768,000 tokens.

Cache-hit rate is cached input divided by total input. Output tokens are excluded.
Main chat calls reuse the DSH session ID as the CLI conversation ID. Auxiliary
title and summary calls keep separate identities and can run concurrently.
The adapter converts CLI inclusive input totals into DSH's separate uncached,
cache-read and cache-write buckets. Provider-reported zero cache reads produce
a zero hit rate. Tool replies and final replies use the same accounting.

## Validation limits

CI installs the pinned runtime, applies Go's patches and this integration, then
runs regression tests. A real SDK against a local synthetic provider covers DSH
write/read, history, images, cancellation, resend and compaction transport, without
paid requests. Flutter tests cover capability persistence and failed-refresh retention.

Development checks fetched 15 current models and completed one DeepSeek V4.1 Flash
`OK` reply with the default Purge prompt. These are not evidence for every model,
Android device or all 86 host patches. Phone installation remains for the owner to try.
