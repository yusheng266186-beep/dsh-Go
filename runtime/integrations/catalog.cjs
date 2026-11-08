// Live CodeBuddy catalog through the unmodified official SDK; no model prompt.
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const transport = require('./codebuddy.cjs');
const efforts = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const positive = (value) => Number.isSafeInteger(value) && value > 0;

function normalize(models) {
  if (!Array.isArray(models) || !models.length || models.length > 1000)
    throw Error('CODEBUDDY_CATALOG_EMPTY');
  const ids = new Set();
  const result = [];
  for (const raw of models) {
    if (raw.disabled === true) continue;
    if (typeof raw.id !== 'string' || !raw.id || ids.has(raw.id)) throw Error('CODEBUDDY_CATALOG_INVALID');
    ids.add(raw.id);
    const contextWindow = positive(raw.maxInputTokens)
      ? raw.maxInputTokens
      : raw.contextWindow?.defaultLength;
    if (!positive(contextWindow) || !positive(raw.maxOutputTokens))
      throw Error('CODEBUDDY_CATALOG_LIMITS_UNKNOWN');
    const declared = raw.reasoning?.supportedEfforts;
    const levels = Array.isArray(declared)
      ? declared.filter((level) => efforts.has(level))
      : [raw.reasoning?.defaultEffort || raw.reasoning?.effort].filter((level) => efforts.has(level));
    const reasoningEfforts =
      raw.supportsReasoning === false
        ? false
        : levels.length
          ? {
              ...(raw.reasoning?.canDisableThinking === true ? { off: null } : {}),
              ...Object.fromEntries(levels.map((level) => [level, level]))
            }
          : undefined;
    result.push({
      id: raw.id,
      name: typeof raw.name === 'string' ? raw.name : raw.id,
      contextWindow,
      maxTokens: raw.maxOutputTokens,
      inputModalities:
        raw.supportsImages === true && raw.disabledMultimodal !== true ? ['text', 'image'] : ['text'],
      ...(reasoningEfforts === undefined ? {} : { reasoningEfforts })
    });
  }
  if (!result.length) throw Error('CODEBUDDY_CATALOG_EMPTY');
  return result;
}

async function discover({ apiKey, root, signal, timeoutMs = 30000 }) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw Error('INVALID_CREDENTIAL');
  if (signal?.aborted) throw Error('ABORTED');
  const sdk = await transport.prepare(root);
  const home = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), '.codebuddy-home');
  await mkdir(home, { recursive: true, mode: 0o700 });
  const session = sdk.unstable_v2_createSession({
    tools: [],
    mcpServers: {},
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    executable: process.execPath,
    cwd: home,
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
  });
  let timer, abort;
  try {
    const interrupted = new Promise((_, reject) => {
      abort = () => reject(Error('ABORTED'));
      signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => reject(Error('CODEBUDDY_CATALOG_TIMEOUT')), timeoutMs);
      if (signal?.aborted) abort();
    });
    return await Promise.race([
      (async () => {
        await session.connect();
        return normalize(await session.getAvailableModelsRaw());
      })(),
      interrupted
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    session.close();
  }
}
module.exports = { discover, normalize };
