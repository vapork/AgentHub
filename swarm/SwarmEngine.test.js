const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { SwarmEngine } = require('./SwarmEngine');

class MockLLM {
  async chatCompletion({ model, messages }) {
    const prompt = messages[0]?.content || '';
    const userMsg = messages[messages.length - 1]?.content || '';

    if (prompt.includes('Decompose the following user goal')) {
      return {
        content: JSON.stringify([
          {
            id: 'task-1',
            title: 'Design API Contracts',
            assignedTo: 'architect',
            description: 'Define schemas',
            acceptanceCriteria: 'Contracts valid',
          },
          {
            id: 'task-2',
            title: 'Implement Handlers',
            assignedTo: 'coder',
            description: 'Write code',
            acceptanceCriteria: 'Code builds and passes tests',
          },
        ]),
      };
    }

    if (prompt.includes('Evaluator / Quality Critic')) {
      return {
        content: JSON.stringify({
          passed: true,
          score: 95,
          diagnosticFeedback: 'Code meets all acceptance criteria.',
        }),
      };
    }

    return {
      content: `Mocked technical response for ${model} on: ${userMsg.slice(0, 50)}`,
    };
  }
}

test('SwarmEngine: Goal Planning & Task Decomposition', async () => {
  const testStorage = path.join(__dirname, 'test_sessions.json');
  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);

  const engine = new SwarmEngine({
    storagePath: testStorage,
    llmClient: new MockLLM(),
  });

  const tasks = await engine.setGoal('Build Inter-Store Stock Transfer Flow');

  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].id, 'task-1');
  assert.equal(tasks[0].assignedTo, 'architect');
  assert.equal(engine.activeGoal, 'Build Inter-Store Stock Transfer Flow');
  assert.equal(engine.manager.status, 'delegating');

  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);
});

test('SwarmEngine: Bidirectional Steering to Manager and Subagent', async () => {
  const testStorage = path.join(__dirname, 'test_sessions2.json');
  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);

  const engine = new SwarmEngine({
    storagePath: testStorage,
    llmClient: new MockLLM(),
  });

  // Steering to Manager
  const resManager = await engine.steer({
    target: 'manager',
    message: 'Prioritize validation tests first',
  });
  assert.equal(resManager.target, 'manager');
  assert.equal(engine.manager.thread.length, 2); // user + agent
  assert.match(engine.manager.decisions[0].decision, /Prioritize validation tests first/);

  // Steering to Subagent Coder
  const resCoder = await engine.steer({
    target: 'coder',
    message: 'Ensure Jest mock polyfill is included',
  });
  assert.equal(resCoder.target, 'coder');
  assert.equal(engine.subagents.coder.thread.length, 2);

  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);
});

test('SwarmEngine: Evaluator-Optimizer Closed Loop Verification', async () => {
  const testStorage = path.join(__dirname, 'test_sessions3.json');
  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);

  let attempt = 0;
  class RetryMockLLM {
    async chatCompletion({ messages }) {
      const prompt = messages[0]?.content || '';
      if (prompt.includes('Decompose')) {
        return {
          content: JSON.stringify([
            {
              id: 'task-1',
              title: 'Implement Feature',
              assignedTo: 'coder',
              description: 'Do work',
              acceptanceCriteria: 'Must pass tests',
            },
          ]),
        };
      }
      if (prompt.includes('Evaluator')) {
        attempt++;
        if (attempt === 1) {
          return {
            content: JSON.stringify({
              passed: false,
              score: 40,
              diagnosticFeedback: 'ReferenceError: TextEncoder is undefined',
            }),
          };
        }
        return {
          content: JSON.stringify({
            passed: true,
            score: 100,
            diagnosticFeedback: 'Fixed TextEncoder fallback. All tests passed.',
          }),
        };
      }
      return { content: 'Code generation output' };
    }
  }

  const engine = new SwarmEngine({
    storagePath: testStorage,
    llmClient: new RetryMockLLM(),
    maxRetries: 3,
    autoApprove: true,
  });

  await engine.setGoal('ESC/POS Printer Service');
  const result = await engine.executeTask('task-1');

  assert.equal(result.success, true);
  assert.equal(result.task.status, 'verified');
  assert.equal(result.task.attempts, 2); // 1 failure + 1 self-correction pass
  assert.equal(result.task.errorHistory.length, 1);
  assert.match(result.task.errorHistory[0], /TextEncoder is undefined/);

  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);
});
