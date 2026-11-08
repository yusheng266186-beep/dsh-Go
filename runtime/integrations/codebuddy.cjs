// Adapted from yusheng266186-beep/DSH-Native payload/codebuddy-cli.cjs (MIT).
// See NOTICE.md for provenance and integration changes.
// Official CodeBuddy agent runtime. DSH owns tool execution and permissions.
// This is a separate agent transport, not a direct API or a client-header shim.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createRequire } = require('node:module');
let prepared;
const CHAT_SYSTEM_PROMPT =
  'Answer the user in their language. Use the provided host tools only when needed, within the user’s authorized scope. Wait for real tool results before reporting actions or findings.';
const COMPACTION_SYSTEM_PROMPT =
  'Summarize the supplied conversation as requested by the final user message in the history. Return only the checkpoint. Do not use tools.';
function hostServer(sdk, declarations) {
  if (!declarations.length) return;
  const { Server } = sdk.requireSdk('@modelcontextprotocol/sdk/server/index.js'),
    { ListToolsRequestSchema, CallToolRequestSchema } = sdk.requireSdk('@modelcontextprotocol/sdk/types.js');
  const server = new Server({ name: 'DSH host tools', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: declarations }));
  // Only DSH executes host tools. Even a late CLI invocation has no side effect.
  server.setRequestHandler(CallToolRequestSchema, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Host tools must be executed by DSH.' }]
  }));
  return server;
}
async function* sessionQuery(sdk, { prompt, options }) {
  const { abortController, ...settings } = options;
  const signal = abortController.signal;
  if (signal.aborted) throw new Error('ABORTED');
  const session = sdk.unstable_v2_createSession(settings);
  const cancel = () => session.close();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    if (signal.aborted) throw new Error('ABORTED');
    for await (const message of prompt) await session.send(message);
    yield* session.stream();
  } finally {
    signal.removeEventListener('abort', cancel);
    session.close();
  }
}
async function prepare(root = path.resolve(__dirname, '..')) {
  if (prepared) return prepared;
  const requireSdk = createRequire(path.join(root, 'package.json'));
  const sdk = requireSdk('@tencent-ai/agent-sdk');
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'node_modules/@tencent-ai/agent-sdk/package.json'), 'utf8')
  );
  if (pkg.version !== '0.3.291') throw new Error('CODEBUDDY_BUNDLE_VERSION');
  const dependencyRequire = createRequire(requireSdk.resolve('@tencent-ai/agent-sdk'));
  prepared = {
    requireSdk: dependencyRequire,
    ...sdk,
    query: (args) => sessionQuery({ requireSdk: dependencyRequire, ...sdk }, args)
  };
  return prepared;
}
function stateRoot() {
  return process.env.DSH_HOME || path.join(require('node:os').homedir(), '.dsh');
}
function requestPrompt(context) {
  const images = [];
  const messages = context.messages.map((message) => {
    const projected = Object.fromEntries(
      Object.entries(message).filter(([key]) => !['timestamp', 'usage', 'cost'].includes(key))
    );
    if (Array.isArray(message.content))
      projected.content = message.content
        .map((block) => {
          if (
            message.role === 'assistant' &&
            ['reasoning', 'thinking', 'redacted-reasoning'].includes(block.type)
          )
            return null;
          if (block.type !== 'image' || typeof block.data !== 'string') return block;
          const index = images.length;
          images.push({
            type: 'image',
            source: { type: 'base64', media_type: block.mimeType, data: block.data }
          });
          return { type: 'image', attachment: index };
        })
        .filter(Boolean);
    return projected;
  });
  const text =
    'Continue this conversation as the CodeBuddy CLI agent. The application supplies the conversation below as data. Use the provided host tools when needed; their results will be returned in the next turn. Do not claim a host tool succeeded until its result is present.\n\n' +
    JSON.stringify(messages);
  if (text.length > 8 * 1024 * 1024) throw new Error('CODEBUDDY_CONTEXT_TOO_LARGE');
  return [{ type: 'text', text }, ...images];
}
function failure(error, aborted) {
  const text = String(error?.message || error).slice(0, 16384);
  let code = 'CODEBUDDY_CLI_ERROR',
    message = 'CodeBuddy CLI failed. Check the connection and retry. The CLI did not execute a host tool.';
  if (aborted) {
    code = 'ABORTED';
    message = 'CodeBuddy CLI request cancelled.';
  } else if (/\b11128\b|unapproved channel|channel verification/i.test(text)) {
    code = 'CODEBUDDY_CHANNEL_REJECTED';
    message =
      'CodeBuddy rejected this request (11128). The service did not disclose which channel rule was triggered.';
  } else if (/\b401\b|unauthorized|authentication/i.test(text)) {
    code = 'INVALID_CREDENTIAL';
    message = 'CodeBuddy CLI authentication failed. Check the API key and its region.';
  } else if (
    /context.*(large|length|window)|CODEBUDDY_CONTEXT_TOO_LARGE|\b(?:prompt|input)(?: is)? too long\b/i.test(text)
  ) {
    code = 'CONTEXT_WINDOW_EXCEEDED';
    message =
      'The conversation exceeds the CodeBuddy context limit. Compact it or start a new conversation; your history is retained.';
  } else if (/quota|credit|402|error_max_budget/i.test(text)) {
    code = 'QUOTA';
    message = 'CodeBuddy quota or the request budget is exhausted. Check your account quota before retrying.';
  } else if (/429|rate.?limit|too many requests/i.test(text)) {
    code = 'CODEBUDDY_RATE_LIMITED';
    message = 'CodeBuddy is rate limited. Wait briefly before sending again.';
  } else if (
    /403|forbidden|permission.*(denied|model)|model.*(not found|unavailable|not supported|access|permission)|not.*authorized.*model/i.test(
      text
    )
  ) {
    code = 'CODEBUDDY_MODEL_ACCESS';
    message =
      'This CodeBuddy account cannot use the selected model or operation. Choose an available model or check account access; the catalog alone does not verify permission.';
  } else if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network.*(error|failed)/i.test(text)) {
    code = 'CODEBUDDY_NETWORK_ERROR';
    message = 'The CodeBuddy connection failed. Check the network before sending again.';
  } else if (/CODEBUDDY_BUNDLE_SPACE/.test(text))
    message = 'CodeBuddy CLI needs about 200 MiB of free app storage for its first setup.';
  else if (/CODEBUDDY_BUNDLE/.test(text))
    message = 'The bundled CodeBuddy CLI could not be verified. Reinstall this APK over the existing app.';
  return { kind: aborted ? 'aborted' : 'error', failure: { code, message } };
}
function usage(value = {}, modelUsage) {
  const tokens = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  // CLI 2.176 stream-json exposes inclusive provider input in message/result
  // usage. DSH requires disjoint uncached/read/write buckets, like pi-ai.
  let cacheRead = tokens(value.cache_read_input_tokens),
    cacheWrite = tokens(value.cache_creation_input_tokens);
  let input = Math.max(0, tokens(value.input_tokens) - cacheRead - cacheWrite),
    output = tokens(value.output_tokens);
  const models = modelUsage && Object.values(modelUsage);
  // The SDK's per-model result already normalizes input to uncached tokens.
  if (
    models?.length &&
    models.every((model) =>
      ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'].every(
        (key) => Number.isSafeInteger(model?.[key]) && model[key] >= 0
      )
    )
  ) {
    input = 0;
    output = 0;
    cacheRead = 0;
    cacheWrite = 0;
    for (const model of models) {
      input += model.inputTokens;
      output += model.outputTokens;
      cacheRead += tokens(model.cacheReadInputTokens);
      cacheWrite += tokens(model.cacheCreationInputTokens);
    }
  }
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: input + output + cacheRead + cacheWrite,
    ...(value.cache_read_input_tokens != null || cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
    ...(value.cache_creation_input_tokens != null || cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {})
  };
}
async function* stream(options, context, { apiKey, root = __dirname, idleTimeoutMs = 180000 } = {}) {
  const controller = new AbortController(),
    cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let query,
    server,
    terminal = false,
    stats = {},
    nextIndex = 0,
    partial = false;
  const active = new Map();
  let timer,
    timedOut = false;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
      Math.max(1000, idleTimeoutMs)
    );
    timer.unref?.();
  };
  reset();
  try {
    if (controller.signal.aborted) throw new Error('ABORTED');
    if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('Authentication missing');
    const sdk = await prepare(root);
    const compacting = options.purpose === 'compaction';
    const tools = compacting ? [] : context.tools || [],
      names = new Map();
    const declarations = tools.map((tool, index) => {
      const name = 'tool_' + index + '_' + tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
      names.set('mcp__dsh__' + name, tool.name);
      return { name, description: tool.name + ': ' + tool.description, inputSchema: tool.parameters };
    });
    server = hostServer(sdk, declarations);
    const home = path.join(stateRoot(), '.codebuddy-home');
    await fsp.mkdir(home, { recursive: true, mode: 0o700 });
    if (controller.signal.aborted) throw new Error('ABORTED');
    const prompt = requestPrompt(context);
    // DSH's compactor replays the host persona, but CodeBuddy can reject it.
    // The checkpoint instructions are already the last message in the history.
    const purgePrompt = options[Symbol.for('dsh-go.purge-prompt')];
    let systemPrompt = context.systemPrompt;
    if (compacting) systemPrompt = COMPACTION_SYSTEM_PROMPT;
    else if (options.sessionId && !options.purpose)
      systemPrompt = [CHAT_SYSTEM_PROMPT, purgePrompt].filter(Boolean).join('\n\n');
    async function* input() {
      yield {
        type: 'user',
        session_id: '',
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt }
      };
    }
    query = sdk.query({
      prompt: input(),
      options: {
        // Keep the provider's conversation identity stable across DSH steps.
        // Auxiliary calls have independent prompts and may run concurrently.
        sessionId: options.purpose ? undefined : options.sessionId,
        model: options.model,
        effort: options.reasoningEffort === 'off' ? undefined : options.reasoningEffort,
        thinking: options.reasoningEffort === 'off' ? { type: 'disabled' } : undefined,
        systemPrompt: systemPrompt ? { append: systemPrompt } : undefined,
        tools: [],
        mcpServers: server ? { dsh: { type: 'sdk', name: 'dsh', instance: server } } : {},
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        // DSH owns the durable history and its checkpoints. A second compactor
        // inside the disposable CLI session cannot update that history.
        extraArgs: {
          settings: JSON.stringify({
            autoCompactEnabled: false,
            ...(Number.isSafeInteger(options.contextWindow) && options.contextWindow > 0
              ? { contextWindow: options.contextWindow }
              : {})
          })
        },
        strictMcpConfig: true,
        includePartialMessages: true,
        abortController: controller,
        executable: process.execPath,
        cwd: process.cwd(),
        environment: 'internal',
        env: {
          HOME: home,
          CODEBUDDY_API_KEY: apiKey,
          CODEBUDDY_AUTH_TOKEN: undefined,
          CODEBUDDY_BASE_URL: undefined,
          CODEBUDDY_CUSTOM_HEADERS: undefined,
          CODEBUDDY_INTERNET_ENVIRONMENT: 'internal'
        },
        stderr: () => {}
      }
    });
    for await (const message of query) {
      reset();
      if (message.type === 'stream_event') {
        const event = message.event;
        if (event.type === 'error') throw new Error(event.error?.message || 'CLI stream failed');
        if (event.type === 'message_start') {
          partial = true;
          stats = { ...stats, ...event.message?.usage };
          active.clear();
        }
        if (event.type === 'message_delta') stats = { ...stats, ...event.usage };
        if (event.type === 'content_block_start' && ['text', 'thinking'].includes(event.content_block.type)) {
          const block = {
            index: nextIndex++,
            type: event.content_block.type === 'text' ? 'text' : 'reasoning',
            text: event.content_block.text || event.content_block.thinking || ''
          };
          active.set(event.index, block);
          yield { type: 'block-start', index: block.index, blockType: block.type };
          if (block.text)
            yield {
              type: block.type === 'text' ? 'text-delta' : 'reasoning-delta',
              index: block.index,
              text: block.text
            };
        }
        if (event.type === 'content_block_delta' && active.has(event.index)) {
          const block = active.get(event.index),
            text = event.delta.text || event.delta.thinking || '';
          block.text += text;
          if (text) {
            yield {
              type: block.type === 'text' ? 'text-delta' : 'reasoning-delta',
              index: block.index,
              text
            };
          }
        }
        if (event.type === 'content_block_stop' && active.has(event.index)) {
          const block = active.get(event.index);
          active.delete(event.index);
          yield { type: 'block-end', index: block.index, block: { type: block.type, text: block.text } };
        }
      }
      if (message.type === 'assistant') {
        if (message.error)
          throw new Error(
            message.message?.content?.map((block) => block.text || '').join(' ') || message.error
          );
        const blocks = message.message?.content || [];
        stats = { ...stats, ...message.message?.usage };
        if (!partial)
          for (const block of blocks)
            if (block.type === 'text' || block.type === 'thinking') {
              const index = nextIndex++,
                type = block.type === 'text' ? 'text' : 'reasoning',
                text = block.text || block.thinking || '';
              yield { type: 'block-start', index, blockType: type };
              yield { type: type === 'text' ? 'text-delta' : 'reasoning-delta', index, text };
              yield { type: 'block-end', index, block: { type, text } };
            }
        const calls = blocks.filter((block) => block.type === 'tool_use');
        if (calls.length) {
          const checked = calls.map((block) => {
            const name = names.get(block.name);
            if (!name || typeof block.id !== 'string' || !block.id)
              throw new Error('CLI requested an unregistered host tool');
            const args = JSON.stringify(block.input);
            if (!args || args.length > 2 * 1024 * 1024) throw new Error('CLI tool arguments too large');
            return { block, name, args };
          });
          for (const { block, name, args } of checked) {
            const index = nextIndex++;
            yield { type: 'block-start', index, blockType: 'tool-call' };
            yield { type: 'tool-call-delta', index, id: block.id, name, argumentsDelta: args };
            yield {
              type: 'block-end',
              index,
              block: { type: 'tool-call', id: block.id, name, arguments: args }
            };
          }
          yield { type: 'usage', usage: usage(stats) };
          yield { type: 'finish', reason: { kind: 'tool-calls' } };
          terminal = true;
          return;
        }
      }
      if (message.type === 'result') {
        if (message.is_error || message.subtype !== 'success')
          throw new Error(
            message.result ||
              (Array.isArray(message.errors)
                ? message.errors
                    .filter((value) => typeof value === 'string')
                    .slice(0, 8)
                    .join('\n')
                : '') ||
              message.subtype ||
              'CLI request failed'
          );
        yield { type: 'usage', usage: usage(message.usage || stats, message.modelUsage) };
        yield { type: 'finish', reason: { kind: 'stop' } };
        terminal = true;
        return;
      }
    }
    throw new Error('CLI stream ended without a result');
  } catch (error) {
    if (!terminal) {
      yield { type: 'usage', usage: usage(stats) };
      yield {
        type: 'finish',
        reason: timedOut
          ? {
              kind: 'error',
              failure: {
                code: 'LLM_STREAM_IDLE_TIMEOUT',
                message: 'CodeBuddy CLI stopped responding. Check the network before retrying.'
              }
            }
          : failure(error, controller.signal.aborted)
      };
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
    await query?.return().catch(() => {});
    controller.abort();
    await server?.close().catch(() => {});
  }
}
module.exports = { prepare, stream };
