const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { LiteLLMClient } = require('./LiteLLMClient');
const { GitWorkspaceEngine } = require('./GitWorkspaceEngine');

class SwarmEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.storagePath = options.storagePath || path.join(__dirname, '..', 'swarm_sessions.json');
    this.sessionsDir = options.sessionsDir || path.join(__dirname, '..', 'sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      try { fs.mkdirSync(this.sessionsDir, { recursive: true }); } catch {}
    }
    this.activeSessionId = options.activeSessionId || null;
    this.llm = options.llmClient || new LiteLLMClient();
    this.gitEngine = options.gitEngine || new GitWorkspaceEngine(options);
    this.autoApplyGit = options.autoApplyGit !== undefined ? options.autoApplyGit : true;
    this.maxRetries = options.maxRetries || 3;
    this.autoApprove = options.autoApprove !== undefined ? options.autoApprove : true;

    this.activeGoal = null;
    this.tasks = [];
    this.currentTaskId = null;
    this.isRunning = false;

    // Manager agent state
    this.manager = {
      id: 'manager',
      name: 'Manager (Antigravity)',
      role: 'Planner, Evaluator & Swarm Director',
      status: 'idle', // idle | planning | delegating | evaluating | waiting_human
      currentThought: 'Standing by for project goals or operator instructions.',
      decisions: [],
      thread: [],
    };

    // Subagents registry (Reflecting full roster in litellm_config.yaml)
    this.subagents = {
      architect: {
        id: 'architect',
        name: 'System Architect',
        icon: '📐',
        role: 'Architecture, Schemas, Component Contracts',
        model: 'swarm-architect',
        status: 'idle',
        currentTask: null,
        thread: [],
        diffs: [],
      },
      coder: {
        id: 'coder',
        name: 'Master Coder',
        icon: '💻',
        role: 'High-Velocity Full-Stack Code Generation',
        model: 'deepseek-flash', // DeepSeek V4.1 Flash (Superior for complex multi-file logic)
        status: 'idle',
        currentTask: null,
        thread: [],
        diffs: [],
      },
      code_monkey: {
        id: 'code_monkey',
        name: 'Rapid Code Monkey',
        icon: '🐵',
        role: 'Instant Scratch Scripting & Rapid Prototyping',
        model: 'agent-code-monkey',
        status: 'idle',
        currentTask: null,
        thread: [],
        diffs: [],
      },
      db: {
        id: 'db',
        name: 'Database Engineer',
        icon: '💾',
        role: 'Postgres Schemas, Migrations & Query Optimization',
        model: 'agent-code-monkey', // Groq GPT-OSS 120B (High-speed SQL, DDL & migrations)
        status: 'idle',
        currentTask: null,
        thread: [],
        diffs: [],
      },
      pm: {
        id: 'pm',
        name: 'Project Manager',
        icon: '📋',
        role: 'Sprint Planning, User Stories & Backlog Grooming',
        model: 'agent-project-manager',
        status: 'idle',
        currentTask: null,
        thread: [],
        diffs: [],
      },
      evaluator: {
        id: 'evaluator',
        name: 'Evaluator / Critic',
        icon: '⚖️',
        role: 'Closed-Loop Evaluator & Quality Critic',
        model: 'agent-qa-engineer',
        status: 'idle',
        currentTask: null,
        thread: [],
        evaluations: [],
      },
      tester: {
        id: 'tester',
        name: 'Test Runner',
        icon: '🧪',
        role: 'Automated Test Suite & Regression Verification',
        model: 'agent-qa-engineer',
        status: 'idle',
        currentTask: null,
        thread: [],
        testRuns: [],
      },
    };

    this.loadState();
  }

  /* ------------------------------------------------------------------ *
   *  State Serialization & Persistence (Avoids 95% Trap)
   * ------------------------------------------------------------------ */
  getState() {
    return {
      activeSessionId: this.activeSessionId,
      activeGoal: this.activeGoal,
      isRunning: this.isRunning,
      autoApprove: this.autoApprove,
      maxRetries: this.maxRetries,
      manager: this.manager,
      subagents: this.subagents,
      tasks: this.tasks,
      currentTaskId: this.currentTaskId,
      autoApplyGit: this.autoApplyGit,
      workspace: this.gitEngine ? this.gitEngine.getWorkspaceInfo() : null,
      stats: {
        totalTasks: this.tasks.length,
        completedTasks: this.tasks.filter((t) => t.status === 'verified').length,
        inProgressTasks: this.tasks.filter((t) => t.status === 'in_progress').length,
        failedTasks: this.tasks.filter((t) => t.status === 'failed').length,
      },
    };
  }

  saveState() {
    try {
      const state = this.getState();
      fs.writeFileSync(this.storagePath, JSON.stringify(state, null, 2), 'utf-8');

      if (this.activeSessionId) {
        const sessionFile = path.join(this.sessionsDir, `${this.activeSessionId}.json`);
        const sessionPayload = {
          id: this.activeSessionId,
          goal: this.activeGoal || 'Untitled Goal',
          createdAt: this.createdAt || Date.now(),
          updatedAt: Date.now(),
          state,
        };
        fs.writeFileSync(sessionFile, JSON.stringify(sessionPayload, null, 2), 'utf-8');
      }

      this.emit('state-saved', state);
    } catch (err) {
      console.error('[SwarmEngine] Failed to save state:', err.message);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf-8'));
        this.activeSessionId = data.activeSessionId || 'sims-sprint-planning';
        if (data.activeGoal) this.activeGoal = data.activeGoal;
        if (Array.isArray(data.tasks)) this.tasks = data.tasks;
        if (data.manager) this.manager = { ...this.manager, ...data.manager };
        if (data.subagents) {
          for (const key of Object.keys(data.subagents)) {
            if (this.subagents[key]) {
              this.subagents[key] = { ...this.subagents[key], ...data.subagents[key] };
            }
          }
        }
        // Save initial snapshot to sessionsDir if not already there
        const sessionFile = path.join(this.sessionsDir, `${this.activeSessionId}.json`);
        if (!fs.existsSync(sessionFile)) {
          const sessionPayload = {
            id: this.activeSessionId,
            goal: this.activeGoal || 'Resume working on SIMS project',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            state: this.getState(),
          };
          fs.writeFileSync(sessionFile, JSON.stringify(sessionPayload, null, 2), 'utf-8');
        }
      } else {
        this.activeSessionId = 'sims-sprint-planning';
      }
    } catch (err) {
      console.warn('[SwarmEngine] Initializing fresh state (no previous session):', err.message);
      this.activeSessionId = 'sims-sprint-planning';
    }
  }

  listSessions() {
    try {
      if (!fs.existsSync(this.sessionsDir)) return [];
      const files = fs.readdirSync(this.sessionsDir).filter((f) => f.endsWith('.json'));
      const list = [];
      for (const f of files) {
        try {
          const content = JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf-8'));
          const sState = content.state || content;
          list.push({
            id: content.id || f.replace('.json', ''),
            goal: content.goal || sState.activeGoal || 'Untitled Session',
            createdAt: content.createdAt || Date.now(),
            updatedAt: content.updatedAt || Date.now(),
            totalTasks: sState.stats?.totalTasks || sState.tasks?.length || 0,
            completedTasks: sState.stats?.completedTasks || (sState.tasks?.filter((t) => t.status === 'verified').length || 0),
            isActive: (content.id || f.replace('.json', '')) === this.activeSessionId,
          });
        } catch {}
      }
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (e) {
      return [];
    }
  }

  resumeSession(sessionId) {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`Session ${sessionId} not found`);
    }
    const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    const sState = data.state || data;
    this.activeSessionId = sessionId;
    this.activeGoal = sState.activeGoal || data.goal || null;
    this.tasks = sState.tasks || [];
    this.currentTaskId = sState.currentTaskId || null;
    this.isRunning = false;
    if (sState.manager) this.manager = { ...this.manager, ...sState.manager };
    if (sState.subagents) {
      for (const key of Object.keys(sState.subagents)) {
        if (this.subagents[key]) {
          this.subagents[key] = { ...this.subagents[key], ...sState.subagents[key] };
        }
      }
    }
    this.saveState();
    this.notify('session-resumed', { sessionId, goal: this.activeGoal });
    return this.getState();
  }

  createSession(goal = 'New Engineering Objective') {
    const newId = `session-${Date.now()}`;
    this.activeSessionId = newId;
    this.activeGoal = goal;
    this.tasks = [];
    this.currentTaskId = null;
    this.isRunning = false;
    this.manager.status = 'idle';
    this.manager.currentThought = `Session started for goal: "${goal}". Ready for decomposition.`;
    this.manager.decisions = [];
    this.manager.thread = [];
    for (const key of Object.keys(this.subagents)) {
      this.subagents[key].status = 'idle';
      this.subagents[key].currentTask = null;
      this.subagents[key].thread = [];
      if (this.subagents[key].evaluations) this.subagents[key].evaluations = [];
      if (this.subagents[key].diffs) this.subagents[key].diffs = [];
    }
    this.saveState();
    this.notify('session-created', { sessionId: newId, goal });
    return this.getState();
  }

  notify(event, payload = {}) {
    const fullState = this.getState();
    this.emit('swarm-event', { event, payload, state: fullState });
    this.saveState();
  }

  /* ------------------------------------------------------------------ *
   *  Goal Planning & Decomposition
   * ------------------------------------------------------------------ */
  async setGoal(goalDescription) {
    if (this.activeGoal && this.activeGoal !== goalDescription) {
      this.activeSessionId = `session-${Date.now()}`;
    } else if (!this.activeSessionId) {
      this.activeSessionId = `session-${Date.now()}`;
    }
    this.activeGoal = goalDescription;
    this.manager.status = 'planning';
    this.manager.currentThought = `Analyzing master goal: "${goalDescription}". Formulating task graph and subagent assignments...`;

    // Reset subagent states for new goal
    for (const key of Object.keys(this.subagents)) {
      this.subagents[key].status = 'idle';
      this.subagents[key].currentTask = null;
      this.subagents[key].thread = [];
    }

    this.manager.thread = [{
      role: 'user',
      content: `Master Goal: ${goalDescription}`,
      timestamp: Date.now(),
    }];

    this.notify('goal-started', { goal: goalDescription });

    // Generate initial task plan
    const prompt = [
      {
        role: 'system',
        content: `You are the Manager Agent of an autonomous AI engineering swarm.
Decompose the following user goal into 2-4 structured, IMPLEMENTATION-FOCUSED tasks.
RULES:
- Distribute tasks across specialized agents: assign Task 1 to 'architect' for interface/component contracts and architecture, Task 2 to 'coder' for production code implementation, and a closing task to 'evaluator' for closed-loop verification.
- Every coder task description MUST instruct the agent to write actual source code files with file path comments on the first line of each code block (e.g. // src/mocks/handlers.js).
- acceptanceCriteria must be concrete and verifiable (e.g. "File X exists with Y function", NOT "code is good").
For each task specify:
- id: "task-1", "task-2", etc.
- title: concise action-oriented title (e.g. "Architect UOM conversion schemas and interfaces")
- assignedTo: 'architect' | 'coder' | 'code_monkey' | 'db' | 'pm' | 'evaluator' | 'tester'
- description: detailed implementation instructions including exact file paths to create
- acceptanceCriteria: specific verifiable condition referencing file names or function names
Respond ONLY in valid JSON array format:
[
  {"id": "task-1", "title": "Architect interface contracts", "assignedTo": "architect", "description": "Define API contracts and schemas...", "acceptanceCriteria": "Complete interface definitions"},
  {"id": "task-2", "title": "Implement core service", "assignedTo": "coder", "description": "Create src/... with...", "acceptanceCriteria": "File exists with full implementation"},
  {"id": "task-3", "title": "Closed-loop verification", "assignedTo": "evaluator", "description": "Audit code quality...", "acceptanceCriteria": "All tests pass"}
]`,
      },
      { role: 'user', content: goalDescription },
    ];

    try {
      const res = await this.llm.chatCompletion({ model: 'swarm-master', messages: prompt });
      let parsedTasks = [];

      try {
        const jsonMatch = res.content.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
          parsedTasks = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        console.warn('[SwarmEngine] Fallback parsing task plan:', parseErr.message);
      }

      if (!parsedTasks || parsedTasks.length === 0) {
        // Fallback: use the actual goal to create implementation-first tasks
        const shortGoal = goalDescription.slice(0, 120);
        parsedTasks = [
          {
            id: 'task-1',
            title: `Implement: ${shortGoal}`,
            assignedTo: 'coder',
            description: `IMPORTANT: Write complete production-ready source code files. Every code block MUST start with a file path comment on the FIRST LINE (e.g. // src/mocks/handlers.js). Write actual runnable code â€” no design docs, no stubs, no TODOs.\n\nGoal: ${goalDescription}`,
            acceptanceCriteria: `Working source code files with file path comments. At least one complete .js/.ts/.jsx file with full implementation.`,
          },
          {
            id: 'task-2',
            title: `Verify & Test: ${shortGoal}`,
            assignedTo: 'evaluator',
            description: `Audit the code deliverable: (1) real code files with path comments present, (2) implementation complete not stubbed, (3) acceptance criteria met.\n\nOriginal Goal: ${goalDescription}`,
            acceptanceCriteria: 'Code is complete, non-stub, contains actual file implementations.',
          },
        ];
      }

      this.tasks = parsedTasks.map((t, idx) => ({
        ...t,
        id: t.id || `task-${idx + 1}`,
        status: idx === 0 ? 'ready' : 'pending',
        attempts: 0,
        logs: [],
        errorHistory: [],
      }));

      this.manager.status = 'delegating';
      this.manager.currentThought = `Task graph established with ${this.tasks.length} tasks. Ready to begin execution.`;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `Decomposed goal into ${this.tasks.length} sequential tasks with acceptance gates.`,
      });

      this.notify('plan-created', { tasks: this.tasks });
      return this.tasks;
    } catch (err) {
      this.manager.status = 'error';
      this.manager.currentThought = `Planning error: ${err.message}`;
      this.notify('error', { message: err.message });
      throw err;
    }
  }

  /* ------------------------------------------------------------------ *
   *  Bidirectional Steering (Direct to Manager OR Subagent)
   * ------------------------------------------------------------------ */
  async steer({ target = 'manager', message, author = 'user' }) {
    const timestamp = Date.now();

    if (target === 'manager') {
      this.manager.thread.push({ role: author, content: message, timestamp });
      this.manager.currentThought = `Received operator guidance: "${message}". Recalibrating swarm plan...`;
      this.notify('manager-steered', { message, target });

      // Manager reasoning on steering
      const prompt = [
        {
          role: 'system',
          content: `You are the Manager Agent. The operator sent you strategic guidance: "${message}".
Evaluate if this requires adjusting existing tasks or pivoting priorities. Respond with a concise action plan.`,
        },
        { role: 'user', content: message },
      ];

      const res = await this.llm.chatCompletion({ model: 'swarm-master', messages: prompt });
      this.manager.thread.push({ role: 'agent', content: res.content, timestamp: Date.now() });
      this.manager.currentThought = res.content.slice(0, 140) + '...';
      this.manager.decisions.push({ timestamp: Date.now(), decision: `Incorporated operator directive: ${message}` });
      this.notify('manager-thought', { thought: this.manager.currentThought });
      return { target: 'manager', reply: res.content };
    }

    // Direct subagent steering
    const agent = this.subagents[target];
    if (!agent) {
      throw new Error(`Unknown target subagent: ${target}`);
    }

    agent.thread.push({ role: author, content: message, timestamp });
    agent.status = 'reasoning';
    this.notify('subagent-steered', { target, message });

    const prompt = [
      {
        role: 'system',
        content: `You are the ${agent.name} (${agent.role}) in an engineering swarm.
The operator is communicating with you directly.
Directive: "${message}"
Acknowledge the instruction and explain how you will adapt your work. Keep response concise and technical.`,
      },
      { role: 'user', content: message },
    ];

    const res = await this.llm.chatCompletion({ model: agent.model, messages: prompt });
    agent.thread.push({ role: 'agent', content: res.content, timestamp: Date.now() });
    agent.status = 'idle';
    this.notify('subagent-response', { target, reply: res.content });
    return { target, reply: res.content };
  }

  /* ------------------------------------------------------------------ *
   *  Subagent Peer Consultation (e.g. Architect Unblocking Coder)
   * ------------------------------------------------------------------ */
  async consultArchitect(taskId, failureFeedback = '') {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const architect = this.subagents.architect;
    const prevStatus = architect.status;
    architect.status = 'reasoning';
    this.manager.status = 'delegating';
    this.manager.currentThought = `Consulting System Architect (@architect) to unblock "${task.title}"...`;

    const assignedAgent = this.subagents[task.assignedTo];
    const prevAssignedStatus = assignedAgent?.status;
    if (assignedAgent && assignedAgent !== architect) {
      assignedAgent.status = 'consulting';
      assignedAgent.currentTask = `Receiving architectural blueprint from System Architect (@architect)...`;
    }
    this.notify('subagent-consulting', { consultant: 'architect', task: task.title });

    const prompt = [
      {
        role: 'system',
        content: `You are the System Architect of the AI engineering swarm.
The Master Coder is struggling to pass evaluation on task: "${task.title}".
Task Description: ${task.description}
Acceptance Criteria: ${task.acceptanceCriteria}
Evaluation Failure Feedback:
"${failureFeedback || (task.errorHistory || []).slice(-1)[0] || 'Task failed evaluation'}"

Provide an authoritative, unambiguous UNBLOCKING ARCHITECTURE BLUEPRINT for the Coder:
1. Exact Component & Interface Specifications (Props, Types, Data Models).
2. Explicit Imports & Dependencies (Exact library package names and named exports, e.g., from @mui/material).
3. Robust Testing & Mocking Strategy (How to mock apiClient and API responses cleanly in Jest/Testing Library without flakiness or JSDOM layout bugs).
Be concrete, precise, and direct so the Coder can implement it without compilation errors.`,
      },
      { role: 'user', content: `Provide unblocking architectural specification for: ${task.title}` },
    ];

    try {
      const res = await this.llm.chatCompletion({ model: architect.model, messages: prompt, maxTokens: 4096 });
      architect.status = prevStatus;
      if (assignedAgent && assignedAgent !== architect) {
        assignedAgent.status = prevAssignedStatus || 'reasoning';
      }
      architect.thread.push({
        role: 'agent',
        content: `### ðŸ“ Unblocking Blueprint for "${task.title}"\n\n${res.content}`,
        taskId: task.id,
        timestamp: Date.now(),
      });
      task.architectGuidance = res.content;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `System Architect synthesized unblocking blueprint for task "${task.title}".`,
      });
      this.notify('architect-guidance-ready', { task, guidance: res.content });
      this.saveState();
      return res.content;
    } catch (e) {
      architect.status = prevStatus;
      if (assignedAgent && assignedAgent !== architect) {
        assignedAgent.status = prevAssignedStatus || 'reasoning';
      }
      console.warn('[SwarmEngine] Failed consulting architect:', e.message);
      return '';
    }
  }

  /* ------------------------------------------------------------------ *
   *  Autonomous Manager Takeover (When Subagent Hits Ceiling)
   * ------------------------------------------------------------------ */
  async takeoverTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const agent = this.subagents[task.assignedTo] || this.subagents.coder;
    this.currentTaskId = taskId;
    task.status = 'in_progress';
    this.manager.status = 'planning';
    this.manager.currentThought = `ðŸ‘‘ Manager taking over "${task.title}". Reviewing evaluator failure history and synthesizing complete, verified implementation...`;

    // Explicitly update subagent state so user sees handover in UI
    agent.status = 'delegated';
    agent.currentTask = `Assisted by ðŸ‘‘ Manager (Autonomous Takeover in progress)`;
    this.notify('manager-takeover-started', { task });

    // Step 1: Consult Architect if not already done
    let archSpec = task.architectGuidance || '';
    if (!archSpec && task.assignedTo !== 'architect') {
      try {
        archSpec = await this.consultArchitect(taskId, (task.errorHistory || []).slice(-1)[0] || 'Task failed evaluation');
        task.architectGuidance = archSpec;
      } catch (e) {
        console.warn('[SwarmEngine] Architect consult fallback in takeover:', e.message);
      }
    }

    // Step 2: Manager synthesizes full verified deliverable
    this.manager.status = 'delegating';
    const managerPrompt = [
      {
        role: 'system',
        content: `You are the Manager Agent (Antigravity), the executive director of the AI engineering swarm.
The assigned subagent (@${task.assignedTo}) has failed multiple attempts on the following task:
Title: ${task.title}
Instructions: ${task.description}
Acceptance Criteria: ${task.acceptanceCriteria}
Architect Guidance: ${archSpec || 'Follow standard system architecture'}
Evaluator Failure History:
${(task.errorHistory || []).map((err, i) => `Defect ${i + 1}: ${err}`).join('\n\n')}

YOU ARE AUTONOMOUSLY TAKING OVER THIS TASK TO GUARANTEE COMPLETE RESOLUTION.
Deliver the complete, authoritative, production-ready solution that directly eliminates EVERY SINGLE DEFECT noted by the Evaluator above:
- Ensure all imports (e.g. from @mui/material, React, testing libraries) are 100% correct and explicitly declared.
- Provide comprehensive, robust code and clean unit tests that will definitively pass evaluation without mock flakiness or layout calculation bugs.
- Do not truncate; finish all files completely.`,
      },
      { role: 'user', content: `Manager Takeover: Deliver complete verified implementation for ${task.title}` },
    ];

    const result = await this.llm.chatCompletion({ model: 'swarm-master', messages: managerPrompt, maxTokens: 8192 });

    this.manager.thread.push({
      role: 'agent',
      content: result.content,
      taskId: task.id,
      timestamp: Date.now(),
    });

    agent.thread.push({
      role: 'agent',
      content: `### ðŸ‘‘ Manager Assisted Resolution\n\n${result.content}`,
      taskId: task.id,
      timestamp: Date.now(),
    });

    task.deliverable = result.content;
    task.logs.push(`[Manager] Autonomously took over and synthesized deliverable (${result.content.length} chars)`);

    // Step 3: Run Evaluator Gate on Manager's solution
    const evalResult = await this._runEvaluatorGate(task, result.content);

    if (evalResult.passed || evalResult.score >= 80) {
      task.status = 'verified';

      // Auto-apply to git workspace if enabled
      if (this.autoApplyGit && !task.gitCommit) {
        try {
          this.gitEngine.applyTaskChanges(task);
          this.notify('task-git-committed', { task, gitCommit: task.gitCommit });
        } catch (gitErr) {
          console.warn('[SwarmEngine] Auto-apply git warning:', gitErr.message);
        }
      }

      agent.status = 'completed';
      agent.currentTask = null;
      this.manager.status = 'idle';
      this.manager.currentThought = `ðŸ‘‘ Manager successfully resolved and verified "${task.title}". Advancing sprint.`;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `Manager took over and successfully verified task "${task.title}". Evaluator Score: ${evalResult.score}/100.`,
      });

      const nextTask = this.tasks.find((t) => t.status === 'pending');
      if (nextTask) nextTask.status = 'ready';

      this.notify('task-completed', { task, evalResult });
      this.saveState();
      return { success: true, task, evalResult, managerTakeover: true };
    } else if (evalResult.score >= 70) {
      // Manager executive override only if score is viable (>=70)
      task.status = 'verified';
      agent.status = 'completed';
      agent.currentTask = null;
      this.manager.status = 'idle';
      this.manager.currentThought = `ðŸ‘‘ Manager approved "${task.title}" with executive override (score: ${evalResult.score}/100).`;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `Manager executive override approved task "${task.title}" (score ${evalResult.score}/100).`,
      });

      const nextTask = this.tasks.find((t) => t.status === 'pending');
      if (nextTask) nextTask.status = 'ready';

      this.notify('task-completed', { task, evalResult });
      this.saveState();
      return { success: true, task, evalResult, managerTakeover: true };
    } else {
      task.status = 'failed';
      agent.status = 'error';
      this.manager.status = 'waiting_human';
      this.manager.currentThought = `Manager takeover for "${task.title}" did not reach acceptance threshold (score ${evalResult?.score || 0}/100). Escalating.`;
      this.notify('task-escalated', { task, evalResult });
      this.saveState();
      return { success: false, task, evalResult, escalated: true };
    }
  }

  /* ------------------------------------------------------------------ *
   *  Task Execution & Evaluator-Optimizer Closed Loop
   * ------------------------------------------------------------------ */
  async executeTask(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const agent = this.subagents[task.assignedTo] || this.subagents.coder;
    this.currentTaskId = taskId;
    if (task.status === 'failed') {
      task.attempts = 0;
    }
    task.status = 'in_progress';
    task.attempts = (task.attempts || 0) + 1;
    agent.status = 'reasoning';
    agent.currentTask = `${task.title} (Attempt ${task.attempts}/${this.maxRetries})`;

    this.manager.status = 'delegating';
    this.manager.currentThought = `Overseeing ${agent.name} executing "${task.title}" (Attempt ${task.attempts}/${this.maxRetries})...`;
    this.notify('task-started', { task, agent: agent.name });

    // Gather prior verified deliverables for architectural alignment
    const priorContext = this.tasks
      .filter((t) => t.status === 'verified' && t.id !== taskId)
      .map((t) => {
        const ag = this.subagents[t.assignedTo];
        const lastMsg = ag?.thread?.filter((m) => m.taskId === t.id).slice(-1)[0];
        const snippet = lastMsg ? lastMsg.content.slice(0, 1000) + '...' : '';
        return `[Verified Task: ${t.title} (@${t.assignedTo})]:\n${snippet}`;
      })
      .join('\n\n');

    
    // GROUND TRUTH REPOSITORY CONTEXT INGESTION:
    // Automatically inspect workspace for files mentioned in task to eliminate "File Blindness"
    let workspaceFileContext = '';
    try {
      const workspaceDir = this.gitEngine?.workspaceDir || 'C:/Users/karan/OneDrive/Desktop/Project/SIMS';
      const textToScan = `${task.title} ${task.description} ${task.acceptanceCriteria}`;
      const pathMatches = textToScan.match(/(?:[a-zA-Z0-9_\-\.\/]+)\.(?:java|js|jsx|ts|tsx|json|ya?ml|css)/g) || [];
      const uniquePaths = [...new Set(pathMatches)];
      let injectedFiles = 0;

      for (const relPath of uniquePaths) {
        if (injectedFiles >= 3) break;
        const candidates = [
          path.resolve(workspaceDir, relPath),
          path.resolve(workspaceDir, 'frontend', relPath),
          path.resolve(workspaceDir, 'frontend/src', relPath),
          path.resolve(workspaceDir, 'backend', relPath),
          path.resolve(workspaceDir, 'backend/src/main/java', relPath),
          path.resolve(workspaceDir, 'ai-service', relPath),
        ];

        for (const cand of candidates) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            const fileContent = fs.readFileSync(cand, 'utf8');
            const snippet = fileContent.length > 8000
              ? fileContent.slice(0, 8000) + '\n// ... [remaining content truncated for prompt limits] ...'
              : fileContent;
            workspaceFileContext += `\n📁 EXISTING GROUND-TRUTH REPOSITORY FILE: ${path.relative(workspaceDir, cand).replace(/\\/g, '/')}\n\`\`\`\n${snippet}\n\`\`\`\n`;
            injectedFiles++;
            break;
          }
        }
      }
    } catch (scanErr) {
      console.warn('[SwarmEngine] Workspace file ingestion warning:', scanErr.message);
    }

    let systemInstructions = `You are ${agent.name}. Execute the assigned task:
Title: ${task.title}
Instructions: ${task.description}
Acceptance Criteria: ${task.acceptanceCriteria}
`;

    if (typeof workspaceFileContext !== 'undefined' && workspaceFileContext) {
      systemInstructions += `\n${workspaceFileContext}\n`;
    }

    if (priorContext) {
      systemInstructions += `\nPrior Verified Project Context & Specifications:\n${priorContext}\n`;
    }

    if (task.architectGuidance) {
      systemInstructions += `\nðŸ“ System Architect Guidance & Blueprint:\n${task.architectGuidance}\n`;
    }

    if (task.managerGuidance) {
      systemInstructions += `\nðŸ‘‘ Manager Strategic Directives:\n${task.managerGuidance}\n`;
    }

    if (task.errorHistory && task.errorHistory.length > 0) {
      systemInstructions += `\nâš ï¸ Previous Evaluation Failures To Fix:\n${task.errorHistory.map((e, idx) => `Defect ${idx + 1}: ${e}`).join('\n\n')}\n`;
    }

    systemInstructions += `\nProvide your complete technical solution. Ensure all imports and types are explicitly declared, all unit tests are robust and non-flaky, and finish all code without truncation.`;

    const prompt = [
      {
        role: 'system',
        content: systemInstructions,
      },
      { role: 'user', content: `Execute task: ${task.title}` },
    ];

    const execResult = await this.llm.chatCompletion({ model: agent.model, messages: prompt, maxTokens: 8192 });
    agent.thread.push({
      role: 'agent',
      content: execResult.content,
      taskId: task.id,
      timestamp: Date.now(),
    });
    task.deliverable = execResult.content;
    task.logs.push(`[${agent.name}] Output generated (${execResult.content.length} chars)`);

    // Step 2: The Evaluator-Optimizer Closed Loop
    const evalResult = await this._runEvaluatorGate(task, execResult.content);

    if (evalResult.passed) {
      task.status = 'verified';

      // Auto-apply to git workspace if enabled
      if (this.autoApplyGit && !task.gitCommit) {
        try {
          this.gitEngine.applyTaskChanges(task);
          this.notify('task-git-committed', { task, gitCommit: task.gitCommit });
        } catch (gitErr) {
          console.warn('[SwarmEngine] Auto-apply git warning:', gitErr.message);
        }
      }

      agent.status = 'completed';
      agent.currentTask = null;
      this.manager.status = 'idle';
      this.manager.currentThought = `Task "${task.title}" verified and accepted against criteria.`;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `Verified task "${task.title}" on attempt ${task.attempts}.`,
      });

      // Unlock next task if available
      const nextTask = this.tasks.find((t) => t.status === 'pending');
      if (nextTask) nextTask.status = 'ready';

      this.notify('task-completed', { task, evalResult });
      this.saveState();
      return { success: true, task, evalResult };
    }

    // Task evaluation failed
    task.errorHistory.push(evalResult.diagnosticFeedback);

    // If attempt 1 failed and no architect guidance yet, consult Architect before attempt 2
    if (task.attempts === 1 && task.assignedTo !== 'architect' && !task.architectGuidance) {
      this.manager.currentThought = `Evaluation rejected task "${task.title}". Consulting System Architect (@architect) to establish unblocking blueprint...`;
      this.notify('task-self-correcting', { task, evalResult });
      try {
        await this.consultArchitect(taskId, evalResult.diagnosticFeedback);
      } catch (err) {
        console.warn('Consult architect error:', err.message);
      }
    }

    if (task.attempts < this.maxRetries && this.autoApprove) {
      this.manager.currentThought = `Evaluation rejected task "${task.title}". Initiating self-correction cycle (${task.attempts}/${this.maxRetries}) with architect guidance...`;
      this.notify('task-self-correcting', { task, evalResult });

      // Recursively attempt self-correction with diagnostic feedback
      return this.executeTask(taskId);
    }

    // If max retries reached and Auto-Heal is ON: Manager Takes Over!
    if (this.autoApprove) {
      this.manager.currentThought = `Assigned agent reached retry limit on "${task.title}". Autonomous Manager Takeover triggered...`;
      this.notify('task-manager-takeover', { task, evalResult });
      return this.takeoverTask(taskId);
    }

    // Exceeded max retries: escalate to operator
    task.status = 'failed';
    agent.status = 'error';
    this.manager.status = 'waiting_human';
    this.manager.currentThought = `Task "${task.title}" failed after ${task.attempts} attempts. Escalating to operator for guidance.`;
    this.notify('task-escalated', { task, evalResult });
    this.saveState();
    return { success: false, task, evalResult, escalated: true };
  }

  async _runEvaluatorGate(task, output) {
    const evaluator = this.subagents.evaluator;
    evaluator.status = 'evaluating';
    this.manager.status = 'evaluating';
    this.notify('evaluation-started', { task: task.title });

    const prompt = [
      {
        role: 'system',
        content: `You are the Evaluator / Quality Critic of the swarm.
Audit the following output against the specified acceptance criteria.
Task: ${task.title}
Acceptance Criteria: ${task.acceptanceCriteria}
Output:
${output}

Respond strictly in JSON format:
{
  "passed": true | false,
  "score": 0-100,
  "diagnosticFeedback": "Precise reason for pass/fail and actionable recommendations"
}`,
      },
      { role: 'user', content: 'Evaluate quality.' },
    ];

    try {
      const res = await this.llm.chatCompletion({ model: evaluator.model, messages: prompt });
      // Default to FAILED â€” only pass if the LLM explicitly returns passed:true
      let parsed = { passed: false, score: 0, diagnosticFeedback: 'Evaluator did not return a valid response.' };

      try {
        const jsonMatch = res.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch {}

      evaluator.evaluations.push({
        taskId: task.id,
        ...parsed,
        timestamp: Date.now(),
      });
      evaluator.status = 'idle';

      return parsed;
    } catch (err) {
      evaluator.status = 'idle';
      // Evaluator errored â€” treat as failure so the coder retries
      return { passed: false, score: 0, diagnosticFeedback: 'Evaluator call failed. Code output must be retried with explicit file content.' };
    }
  }

  /* ------------------------------------------------------------------ *
   *  Controls & Swarm Automation
   * ------------------------------------------------------------------ */
  async runAll() {
    this.isRunning = true;
    this.notify('swarm-started');

    for (const task of this.tasks) {
      if (!this.isRunning) break;
      if (task.status === 'verified') continue;

      const result = await this.executeTask(task.id);
      if (result && !result.success && result.escalated) {
        this.isRunning = false;
        break;
      }
    }

    this.isRunning = false;
    this.notify('swarm-finished');
  }

  pause() {
    this.isRunning = false;
    this.manager.status = 'idle';
    this.manager.currentThought = 'Swarm execution paused by operator.';
    this.notify('swarm-paused');
  }

  setAutoApprove(val) {
    this.autoApprove = Boolean(val);
    this.notify('auto-approve-changed', { autoApprove: this.autoApprove });
  }

  /* ------------------------------------------------------------------ *
   *  Workspace & Git Operations (Aider & Git Commit Pipeline)
   * ------------------------------------------------------------------ */
  getWorkspaceInfo() {
    return this.gitEngine.getWorkspaceInfo();
  }

  setWorkspaceDir(dir) {
    const res = this.gitEngine.setWorkspace(dir);
    this.notify('workspace-changed', res);
    this.saveState();
    return res;
  }

  setAutoApplyGit(val) {
    this.autoApplyGit = Boolean(val);
    this.notify('auto-apply-git-changed', { autoApplyGit: this.autoApplyGit });
  }

  async applyTaskToWorkspace(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    this.manager.currentThought = `Applying verified changes for "${task.title}" to git workspace...`;
    const res = this.gitEngine.applyTaskChanges(task);
    this.manager.decisions.push({
      timestamp: Date.now(),
      decision: `Committed task "${task.title}" to git (${task.gitCommit.shortHash}): ${task.gitCommit.message}`,
    });
    this.notify('task-git-committed', { task, gitCommit: task.gitCommit });
    this.saveState();
    return res;
  }

  async runAiderOnTask(taskId, options = {}) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const agent = this.subagents[task.assignedTo] || this.subagents.coder;
    agent.status = 'writing';
    agent.currentTask = `Running aider pair programmer on "${task.title}"...`;
    this.manager.currentThought = `Executing aider CLI in workspace for task "${task.title}"...`;
    this.notify('subagent-status', { agent: task.assignedTo, status: 'writing' });

    try {
      const res = await this.gitEngine.runAider(task, options);
      agent.status = 'completed';
      agent.currentTask = null;
      this.manager.currentThought = `Aider successfully completed and committed "${task.title}".`;
      this.manager.decisions.push({
        timestamp: Date.now(),
        decision: `Aider committed task "${task.title}" (${task.gitCommit.shortHash}).`,
      });
      this.notify('task-git-committed', { task, gitCommit: task.gitCommit });
      this.saveState();
      return res;
    } catch (err) {
      agent.status = 'idle';
      this.manager.currentThought = `Aider execution failed: ${err.message}`;
      throw err;
    }
  }

  revertTaskCommit(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!task.gitCommit || !task.gitCommit.hash) {
      throw new Error(`Task "${task.title}" has no git commit to revert.`);
    }

    const res = this.gitEngine.revertCommit(task.gitCommit.hash);
    task.gitCommit.reverted = true;
    task.gitCommit.revertHash = res.revertCommitHash;
    this.manager.decisions.push({
      timestamp: Date.now(),
      decision: `Reverted commit ${task.gitCommit.shortHash} for task "${task.title}".`,
    });
    this.notify('task-git-reverted', { task, result: res });
    this.saveState();
    return res;
  }

  getTaskDiff(taskId) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!task.gitCommit || !task.gitCommit.hash) {
      throw new Error(`Task "${task.title}" has no associated git commit.`);
    }
    return this.gitEngine.getCommitDiff(task.gitCommit.hash);
  }
}

module.exports = { SwarmEngine };


