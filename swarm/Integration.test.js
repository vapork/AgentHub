const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SwarmEngine } = require('./SwarmEngine');

test('SwarmEngine & Server Route Logic Integration Test', async (t) => {
  const testStorage = path.join(__dirname, 'test_swarm_sessions.json');
  if (fs.existsSync(testStorage)) fs.unlinkSync(testStorage);

  const swarm = new SwarmEngine({ storagePath: testStorage });

  await t.test('1. Initial State Snapshot', () => {
    const state = swarm.getState();
    assert.ok(state.manager);
    assert.equal(state.manager.name, 'Manager (Antigravity)');
    assert.ok(state.subagents.architect);
    assert.ok(state.subagents.coder);
    assert.ok(state.subagents.evaluator);
    assert.ok(state.subagents.tester);
    assert.equal(state.activeGoal, null);
    assert.equal(state.tasks.length, 0);
  });

  await t.test('2. Goal Decomposition & Event Broadcasting', async () => {
    const broadcastedEvents = [];
    swarm.on('swarm-event', (evt) => {
      broadcastedEvents.push(evt);
    });

    const tasks = await swarm.setGoal('Implement Stock Transfer verification barcode scanner in SIMS');
    assert.ok(Array.isArray(tasks));
    assert.ok(tasks.length >= 3);
    assert.equal(swarm.activeGoal, 'Implement Stock Transfer verification barcode scanner in SIMS');

    // Verify task assignment to specialized agents
    const assignedAgents = tasks.map(tk => tk.assignedTo);
    assert.ok(assignedAgents.includes('architect'));
    assert.ok(assignedAgents.includes('coder'));

    // Verify event was emitted
    const goalEvt = broadcastedEvents.find(e => e.event === 'goal-started');
    assert.ok(goalEvt);
    assert.equal(goalEvt.payload.goal, 'Implement Stock Transfer verification barcode scanner in SIMS');
  });

  await t.test('3. Bidirectional Steering: Human to Subagent & Manager', async () => {
    // Human steers @coder directly
    const coderRes = await swarm.steer({
      target: 'coder',
      message: 'Ensure fallback to manual entry if camera is unavailable on mobile device',
      author: 'user'
    });

    assert.equal(coderRes.target, 'coder');
    assert.ok(coderRes.reply);
    assert.ok(swarm.subagents.coder.thread.some(msg => msg.content.includes('manual entry')));

    // Human steers @manager directly
    const mgrRes = await swarm.steer({
      target: 'manager',
      message: 'Run automated evaluator audit before marking task ready for deployment',
      author: 'user'
    });

    assert.equal(mgrRes.target, 'manager');
    assert.ok(mgrRes.reply);
    assert.ok(swarm.manager.thread.some(msg => msg.content.includes('evaluator audit')));
    assert.ok(swarm.manager.decisions.length > 0);
  });

  await t.test('4. Task Execution with Evaluator-Optimizer Closed Loop', async () => {
    // Find ready task
    const readyTask = swarm.tasks.find(tk => tk.status === 'ready');
    assert.ok(readyTask);

    const execResult = await swarm.executeTask(readyTask.id);
    assert.ok(execResult.task);
    assert.ok(execResult.evalResult);
    assert.ok(execResult.evalResult.score >= 0);
    assert.ok(execResult.evalResult.diagnosticFeedback);

    // State reflects completed or in-progress
    const updated = swarm.tasks.find(tk => tk.id === readyTask.id);
    assert.ok(updated.attempts >= 1);
  });

  await t.test('5. Session Persistence to Disk', () => {
    assert.ok(fs.existsSync(testStorage));
    const saved = JSON.parse(fs.readFileSync(testStorage, 'utf8'));
    assert.equal(saved.activeGoal, 'Implement Stock Transfer verification barcode scanner in SIMS');
    assert.ok(saved.tasks.length >= 3);
    assert.ok(saved.subagents.coder.thread.length > 0);

    // Clean up test file
    fs.unlinkSync(testStorage);
  });
});
