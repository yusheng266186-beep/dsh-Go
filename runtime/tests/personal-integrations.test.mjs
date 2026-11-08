import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { normalize } = require('../integrations/catalog.cjs');
const prefix = process.env.DSH_TEST_PREFIX || process.env.DSH_PREFIX;

test('live catalog carries limits, image flags and exact reasoning levels', () => {
  const raw = {
    id: 'new-model',
    name: 'New model',
    maxInputTokens: 1000000,
    maxOutputTokens: 128000,
    supportsImages: true,
    supportsReasoning: true,
    reasoning: { canDisableThinking: true, supportedEfforts: ['low', 'high', 'max'] }
  };
  const [m] = normalize([raw]);
  assert.deepEqual(m, {
    id: 'new-model',
    name: 'New model',
    contextWindow: 1000000,
    maxTokens: 128000,
    inputModalities: ['text', 'image'],
    reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' }
  });
  assert.deepEqual(normalize([{ ...raw, disabledMultimodal: true }])[0].inputModalities, ['text']);
  assert.equal(normalize([{ ...raw, supportsReasoning: false }])[0].reasoningEfforts, false);
  assert.deepEqual(normalize([{ ...raw, reasoning: { effort: 'high' } }])[0].reasoningEfforts, {
    high: 'high'
  });
  assert.throws(() => normalize([{ ...raw, maxInputTokens: undefined }]), /LIMITS_UNKNOWN/);
  assert.throws(() => normalize([{ ...raw, disabled: true }]), /EMPTY/);
  assert.throws(() => normalize([raw, raw]), /INVALID/);
});

test(
  'CodeBuddy keeps task prompts and uses its compatible prompt for agent chats',
  { skip: !prefix && 'prepared runtime required' },
  async () => {
    const cli = require(resolve(prefix, 'dsh-go-integrations/codebuddy.cjs'));
    const sdk = await cli.prepare(prefix),
      original = sdk.query;
    const home = mkdtempSync(join(tmpdir(), 'dsh-go-sdk-test-')),
      previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    let sent;
    sdk.query = (args) => {
      sent = args;
      return (async function* () {
        yield { type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 1 } };
      })();
    };
    try {
      const out = await Array.fromAsync(
        cli.stream(
          { model: 'new-model', reasoningEffort: 'max', contextWindow: 512000, sessionId: 'test', purpose: 'session-title' },
          {
            systemPrompt: 'PURGE-SYNTHETIC-PROBE',
            messages: [{ role: 'user', content: 'Synthetic' }],
            tools: []
          },
          { root: prefix, apiKey: 'synthetic-key' }
        )
      );
      assert.equal(out.at(-1).reason.kind, 'stop');
      assert.equal(sent.options.systemPrompt.append, 'PURGE-SYNTHETIC-PROBE');
      assert.equal(sent.options.env.CODEBUDDY_API_KEY, 'synthetic-key');
      assert.equal(sent.options.env.CODEBUDDY_CUSTOM_HEADERS, undefined);
      assert.equal(sent.options.effort, 'max');
      assert.equal(JSON.parse(sent.options.extraArgs.settings).contextWindow, 512000);
      assert.deepEqual(sent.options.tools, []);
      assert.equal(sent.options.persistSession, false);
      const chat = await Array.fromAsync(
        cli.stream(
          { model: 'new-model', sessionId: 'test' },
          {
            systemPrompt: 'UNSUPPORTED-HOST-PERSONA',
            messages: [{ role: 'user', content: 'Synthetic' }],
            tools: []
          },
          { root: prefix, apiKey: 'synthetic-key' }
        )
      );
      assert.equal(chat.at(-1).reason.kind, 'stop');
      assert.match(sent.options.systemPrompt.append, /authorized scope/);
      assert.doesNotMatch(sent.options.systemPrompt.append, /UNSUPPORTED-HOST-PERSONA/);
      const standardPrompt = sent.options.systemPrompt.append;
      for (const presetPrompt of ['Red Team preset', 'Unrestricted preset']) {
        const result = await Array.fromAsync(
          cli.stream(
            { model: 'new-model', sessionId: 'test', [Symbol.for('dsh-go.purge-prompt')]: presetPrompt },
            {
              systemPrompt: 'UNSUPPORTED-HOST-PERSONA',
              messages: [{ role: 'user', content: 'Synthetic' }],
              tools: []
            },
            { root: prefix, apiKey: 'synthetic-key' }
          )
        );
        assert.equal(result.at(-1).reason.kind, 'stop');
        assert.equal(sent.options.systemPrompt.append, `${standardPrompt}\n\n${presetPrompt}`);
      }
    } finally {
      sdk.query = original;
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test(
  'real pi-ai consumer advertises and dispatches the same model metadata',
  { skip: !prefix && 'prepared runtime required' },
  async () => {
    const load = (name) =>
      import(pathToFileURL(resolve(prefix, 'node_modules/@deepseek-ai', name, 'lib/index.js')));
    const [{ Context }, { LlmRuntime }, piai] = await Promise.all([
      load('cordis'),
      load('dsh-llm'),
      load('dsh-llm-pi-ai')
    ]);
    const ctx = new Context(),
      llm = new LlmRuntime(ctx);
    let adapter;
    const register = llm.registerAdapter.bind(llm);
    llm.registerAdapter = (routes, value) => {
      adapter = value;
      return register(routes, value);
    };
    const model = {
      id: 'new-model',
      name: 'New live model',
      contextWindow: 512000,
      maxTokens: 64000,
      input: ['text'],
      reasoningEfforts: { low: 'low', max: 'max' }
    };
    const cli = require(resolve(prefix, 'dsh-go-integrations/codebuddy.cjs')),
      sdk = await cli.prepare(prefix),
      original = sdk.query;
    let sent;
    sdk.query = (args) => {
      sent = args;
      return (async function* () {
        yield { type: 'result', subtype: 'success', usage: { output_tokens: 1 } };
      })();
    };
    const home = mkdtempSync(join(tmpdir(), 'dsh-go-consumer-')),
      previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
      await ctx.plugin(piai, {
        providers: {
          'custom-codebuddy': {
            api: 'openai-completions',
            baseURL: 'https://www.codebuddy.cn/v2',
            models: [model]
          }
        }
      });
      assert(adapter, 'real adapter registered');
      adapter.config.resolveApiKey = async () => 'synthetic-key';
      const info = await adapter.resolveModel('custom-codebuddy', 'new-model');
      assert.equal(info.context.contextWindow, 512000);
      assert.equal(info.defaultMaxTokens, 64000);
      const output = await Array.fromAsync(
        adapter.stream({
          provider: 'custom-codebuddy',
          model: 'new-model',
          reasoningEffort: 'max',
          messages: [
            { role: 'system', content: [{ type: 'text', text: 'PURGE-CONSUMER-PROBE' }] },
            { role: 'user', content: [{ type: 'text', text: 'Synthetic' }] }
          ],
          tools: []
        })
      );
      assert.equal(output.at(-1).reason.kind, 'stop');
      assert(sent.options.systemPrompt.append.includes('PURGE-CONSUMER-PROBE'));
      assert.equal(JSON.parse(sent.options.extraArgs.settings).contextWindow, 512000);
      assert.equal(sent.options.effort, 'max');
    } finally {
      sdk.query = original;
      await ctx.fiber.dispose();
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test(
  'catalog refresh creates fresh metadata sessions and rejects incomplete data',
  { skip: !prefix && 'prepared runtime required' },
  async () => {
    const cli = require(resolve(prefix, 'dsh-go-integrations/codebuddy.cjs'));
    const catalog = require(resolve(prefix, 'dsh-go-integrations/catalog.cjs'));
    const sdk = await cli.prepare(prefix),
      original = sdk.unstable_v2_createSession;
    const load = (file) => import(pathToFileURL(resolve(prefix, 'node_modules/@deepseek-ai', file)));
    const [{ Context }, { LlmRuntime }, piai, { TYPERT }] = await Promise.all([
      load('cordis/lib/index.js'),
      load('dsh-llm/lib/index.js'),
      load('dsh-llm-pi-ai/lib/index.js'),
      load('dsh-llm/lib/typert.host.js')
    ]);
    const ctx = new Context();
    const llm = new LlmRuntime(ctx);
    const home = mkdtempSync(join(tmpdir(), 'dsh-go-catalog-test-')),
      previous = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    let calls = 0,
      closed = 0,
      complete = true;
    sdk.unstable_v2_createSession = (options) => {
      assert.deepEqual(options.tools, []);
      assert.equal(options.persistSession, false);
      calls++;
      return {
        connect: async () => {},
        getAvailableModelsRaw: async () => [
          {
            id: 'latest-' + calls,
            maxInputTokens: 1000000,
            maxOutputTokens: complete ? 128000 : undefined,
            supportsImages: true,
            supportsReasoning: true,
            reasoning: { supportedEfforts: ['low', 'max'] }
          }
        ],
        close: () => {
          closed++;
        }
      };
    };
    try {
      const first = await catalog.discover({ root: prefix, apiKey: 'synthetic-catalog-key' });
      const next = await catalog.discover({ root: prefix, apiKey: 'synthetic-catalog-key' });
      assert.notEqual(first[0].id, next[0].id);
      assert.equal(calls, 2);
      assert.equal(closed, 2);
      await ctx.plugin(piai, { providers: {} });
      const result = await llm.remoteDiscoverModels('llm-pi-ai', {
        baseURL: 'https://www.codebuddy.cn/v2',
        api: 'openai-completions',
        apiKey: 'synthetic-catalog-key'
      });
      const schema = TYPERT.invocations
        .find((entry) => entry.method === 'discoverModels')
        .result.spec.create();
      assert.deepEqual(schema.parse(result), [
        {
          id: 'latest-3',
          name: 'latest-3',
          contextWindow: 1000000,
          maxTokens: 128000,
          inputModalities: ['text', 'image'],
          reasoningEfforts: { low: 'low', max: 'max' }
        }
      ]);
      complete = false;
      await assert.rejects(
        catalog.discover({ root: prefix, apiKey: 'synthetic-catalog-key' }),
        /LIMITS_UNKNOWN/
      );
      assert.equal(first[0].contextWindow, 1000000);
    } finally {
      sdk.unstable_v2_createSession = original;
      await ctx.fiber.dispose();
      if (previous === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previous;
      rmSync(home, { recursive: true, force: true });
    }
  }
);

test('Purge layer and dependency are pinned to the reviewed artifact', () => {
  const lock = JSON.parse(
    readFileSync(new URL('../locks/dsh-0.2.2-rc.1/package-lock.json', import.meta.url))
  );
  const pkg = lock.packages['node_modules/dsh-purge-community'];
  assert.equal(pkg.version, '1.6.84');
  assert(pkg.integrity.startsWith('sha512-'));
  assert(pkg.resolved.includes('/v1.6.84/'));
  assert(
    readFileSync(new URL('../integrations/purge.patch.yml', import.meta.url), 'utf8').includes(
      'autoApplyOnStart: false'
    )
  );
});

test('bundled Android supports Red Team conversation without claiming scanner setup', {
  skip: !prefix && 'prepared runtime required'
}, async () => {
  const { envAdaptStatus, savePlatformConfig } = await import(
    pathToFileURL(resolve(prefix, 'node_modules/dsh-purge-community/lib/redteam/platform-config.js'))
  );
  const runtime = mkdtempSync(join(tmpdir(), 'dsh-go-redteam-test-'));
  const root = join(runtime, 'redteam');
  const previous = process.env.DSH_GO_RUNTIME_ROOT;
  try {
    process.env.DSH_GO_RUNTIME_ROOT = runtime;
    const markerDir = join(runtime, 'etc', 'dsh-app');
    mkdirSync(markerDir, { recursive: true });
    writeFileSync(join(markerDir, 'runtime.json'), '{}');
    const bundled = envAdaptStatus(root);
    assert.equal(bundled.ready, true);
    assert.equal(bundled.reason, 'bundled-runtime');
    assert.equal(bundled.configured, false);
    assert.equal(bundled.skipped, false);
    savePlatformConfig({ envAdaptSkip: true }, root);
    assert.equal(envAdaptStatus(root).reason, 'skipped');
  } finally {
    if (previous === undefined) delete process.env.DSH_GO_RUNTIME_ROOT;
    else process.env.DSH_GO_RUNTIME_ROOT = previous;
    rmSync(runtime, { recursive: true, force: true });
  }
});
