// Public Team spawning, genuine JSONL prefixes and actual cold Lead recovery.
// A: R1 is the sole expected semantic failure; C1-C4 must pass.
// B: all five pass. Every case also requires one TRACE with fixtureFailures: [].
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const legacy = existsSync(join(process.env.DSH_PREFIX, 'node_modules/@deepseek-ai/dsh-experimental-agent-team/lib/index.js'));
const { coldTeamCase } = legacy ? await import('./support/team-input-recovery-fixture.mjs') : {};
const options = { skip: !legacy && 'rc.5 replaces the experimental spawning roster with the task-DAG Team service' };

test('team cold recovery R1: an unadmitted spawn claim remains a teammate', options, async t => {
  const actual = await coldTeamCase(t, 'claim');
  assert.deepEqual(actual, { phase: 'active', status: 'inactive' });
});

test('team cold recovery C1: a never-claimed queued prompt remains a teammate', options, async t => {
  const actual = await coldTeamCase(t, 'pending');
  assert.deepEqual(actual, { phase: 'active', status: 'inactive' });
});

test('team cold recovery C2: publicly removed queued input is not accepted', options, async t => {
  const actual = await coldTeamCase(t, 'canceled');
  assert.deepEqual(actual, { phase: 'failed', status: 'failed' });
});

test('team cold recovery C3: pre-step rejection consumes and blocks initial input', options, async t => {
  const actual = await coldTeamCase(t, 'blocked');
  assert.deepEqual(actual, { phase: 'failed', status: 'failed' });
});

test('team cold recovery C4: inherited fork input cannot replace canceled child-owned input', options, async t => {
  const actual = await coldTeamCase(t, 'fork-canceled');
  assert.deepEqual(actual, { phase: 'failed', status: 'failed' });
});
