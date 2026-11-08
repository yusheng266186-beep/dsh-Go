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

Its 86 host patches keep the explicit Apply/Revert workflow. Installing this
branch does not silently apply them. After applying, stop and restart the local
engine and check the actual status; drift is not success. Runtime upgrades replace
the host tree. Recheck before applying again. Existing Purge settings are preserved.

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
This avoids forwarding the composed DSH system prompt that triggered 11128.
Explicit tasks such as title generation keep their prompt. The selected native
preset still controls tools and skills. Each provider decides what it can answer.

Each directory fetch creates a fresh SDK metadata session and calls
`getAvailableModelsRaw()` without sending a generation prompt. There is no fixed
table or completed-result cache standing in for a refresh. Names, declared thinking levels, image
capability, context and output limits pass through discovery, persistence and the
actual model consumer. The selected context budget also reaches the official CLI.
No selected effort means the service default. Unknown vision does not enable
images. Missing token limits, empty results or errors fail the refresh and keep
the saved directory. Discovery does not prove paid generation access to every model.

## Validation limits

CI installs the pinned runtime, applies Go's patches and this integration, then
runs regression tests. A real SDK against a local synthetic provider covers DSH
write/read, history, images, cancellation, resend and compaction transport, without
paid requests. Flutter tests cover capability persistence and failed-refresh retention.

Development checks fetched 15 current models and completed one DeepSeek V4.1 Flash
`OK` reply with the default Purge prompt. These are not evidence for every model,
Android device or all 86 host patches. Phone installation remains for the owner to try.
