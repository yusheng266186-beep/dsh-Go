import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const prefix = process.env.DSH_TEST_PREFIX ?? process.env.DSH_PREFIX;
const load = (name) => import(pathToFileURL(resolve(prefix, 'node_modules/@deepseek-ai', name, 'lib/index.js')));

async function fixture(options = {}) {
  const [{ Context }, { SessionStore }, { SessionProjectionRegistry }, { TokenMeter }, llm,
    { BasicCompactionEngine }] = await Promise.all([
    'cordis', 'dsh-session', 'dsh-session-projection', 'dsh-token-meter', 'dsh-llm', 'dsh-compaction-basic'
  ].map(load));
  const ctx = new Context();
  for (const plugin of [SessionStore, SessionProjectionRegistry, TokenMeter, llm.LlmRuntime]) await ctx.plugin(plugin);
  const calls = [];
  const available = new Set(['hy4std', 'summary-model', ...(options.keepOld ? ['hy4free'] : [])]);
  class Adapter extends llm.LlmAdapter {
    async resolveModel(provider, model) {
      if (options.lookupError && model === 'hy4free') throw new llm.LlmError('lookup failed', options.lookupError);
      if (!available.has(model)) throw new llm.LlmError(`missing model ${model}`, 'UNKNOWN_MODEL');
      return { provider, id: model, name: model, inputModalities: ['text'], context: { contextWindow: 4096 }, defaultMaxTokens: 256 };
    }
    async *stream(request) {
      calls.push(request);
      yield { type: 'block-start', index: 0, blockType: 'text' };
      const text = 'The first turn supplied verification phrase WILLOW-92816. Continue the user task.';
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['custom-codebuddy-cli'], new Adapter());
  await ctx.plugin(BasicCompactionEngine, {
    headroomTokens: 128, maxTokens: 256, retainTokens: 200,
    ...(options.explicitSummary ? { summarizationProvider: 'custom-codebuddy-cli', summarizationModel: options.explicitSummary } : {})
  });
  const session = ctx.sessions.create('model-switch-fixture', { meta: { cwd: '/tmp' } });
  const old = { provider: options.deletedProvider ? 'removed-provider' : 'custom-codebuddy-cli', model: 'hy4free' };
  const selected = { provider: 'custom-codebuddy-cli', model: 'hy4std' };
  session.append('request/header', { header: { config: old } });
  session.append('turn/start', { turn: 0 });
  for (let i = 0; i < 3; i++) session.append('user/message', llm.createUserMessage({
    content: [{ type: 'text', text: `${i === 0 ? 'WILLOW-92816 ' : ''}${'a'.repeat(12000)}` }]
  }), { surfaceOp: 'append' });
  const agent = { session, options: old, model: { current: () => selected } };
  const before = session.snapshotEvents();
  const signal = options.signal ?? new AbortController().signal;
  const switchModel = () => ctx.waterfall('agent/request', { agent, signal }, async () => selected);
  return { ctx, session, old, selected, calls, before, switchModel };
}

for (const deletedProvider of [false, true]) test(`model switch compacts with the selected model after ${deletedProvider ? 'provider' : 'model'} removal`, {
  skip: !prefix && 'prepared runtime required'
}, async () => {
  const f = await fixture({ deletedProvider });
  try {
    assert.deepEqual(await f.switchModel(), f.selected);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].model, 'hy4std');
    assert.equal(f.calls[0].purpose, 'compaction');
    const summaries = f.session.snapshotEvents().filter((event) => event.type === 'compaction/summary');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].data.model, 'hy4std');
    assert(JSON.stringify(summaries[0].data.summary).includes('WILLOW-92816'));
    assert.deepEqual(f.session.snapshotEvents().slice(0, f.before.length), f.before);
    assert.deepEqual(f.session.requestHeader().config, f.old, 'switch proposal does not rewrite the old request before it succeeds');
  } finally { await f.ctx.fiber.dispose(); }
});

for (const [options, expected] of [
  [{ keepOld: true }, 'hy4free'],
  [{ explicitSummary: 'summary-model' }, 'summary-model']
]) test(`model switch keeps the available or explicitly configured summarizer ${expected}`, {
  skip: !prefix && 'prepared runtime required'
}, async () => {
  const f = await fixture(options);
  try {
    assert.deepEqual(await f.switchModel(), f.selected);
    assert.equal(f.calls[0].model, expected);
  } finally { await f.ctx.fiber.dispose(); }
});

for (const options of [{ lookupError: 'NETWORK_ERROR' }, { explicitSummary: 'hy4free' }]) test(`failed summarizer resolution preserves history ${JSON.stringify(options)}`, {
  skip: !prefix && 'prepared runtime required'
}, async () => {
  const f = await fixture(options);
  try {
    await assert.rejects(f.switchModel(), { code: 'MODEL_SWITCH_COMPACTION_FAILED' });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.session.snapshotEvents().slice(0, f.before.length), f.before);
    assert.equal(f.session.snapshotEvents().some((event) => event.type === 'compaction/summary'), false);
    assert.deepEqual(f.session.requestHeader().config, f.old);
  } finally { await f.ctx.fiber.dispose(); }
});
