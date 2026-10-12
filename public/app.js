(() => {
  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        const agentSelect = document.getElementById('agent-select');
        const panel = document.getElementById('orchestrator-panel');
        const helpText = panel.querySelector('span:last-child');
        
        data.models.forEach(m => {
          // Add to main dropdown after aider
          if (!Array.from(agentSelect.options).some(o => o.value === m)) {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            agentSelect.insertBefore(opt, agentSelect.options[2]);
          }
          // Add to orchestrator panel
          if (!panel.querySelector(`input[value="${m}"]`)) {
            const lbl = document.createElement('label');
            lbl.style.cssText = 'font-size: 0.85rem; display: flex; align-items: center; gap: 4px; cursor: pointer;';
            lbl.innerHTML = `<input type="checkbox" class="subagent-cb" value="${m}"> ${m}`;
            panel.insertBefore(lbl, helpText);
          }
        });
      }
    } catch (e) {
      console.error('Failed to load models:', e);
    }
  }
  loadModels();
  
  const titleBtn = document.getElementById('title-btn');
  const terminal = document.getElementById('terminal-container');
  const agentSelect = document.getElementById('agent-select');
  const btnSpawn = document.getElementById('btn-spawn');
  const btnClear = document.getElementById('btn-clear');
  const btnAuto = document.getElementById('btn-auto');
  const btnSettings = document.getElementById('btn-settings');
  const btnOrchestrator = document.getElementById('btn-orchestrator');
  const inputForm = document.getElementById('input-form');
  const commandInput = document.getElementById('command-input');
  const quickActionBtns = document.querySelectorAll('.quick-actions button');
  const settingsModal = document.getElementById('settings-modal');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnSettingsCancel = document.getElementById('btn-settings-cancel');
  const btnSettingsSave = document.getElementById('btn-settings-save');

  const btnViewToggle = document.getElementById('btn-view-toggle');
  const chatContainer = document.getElementById('chat-container');

  let term = new Terminal({
    theme: { background: '#0d0e12' },
    fontFamily: '"SFMono-Regular", Consolas, monospace',
    convertEol: true
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  
  const resizeObserver = new ResizeObserver(() => {
    if (!isChatView && terminal.style.display !== 'none') {
      try { 
        fitAddon.fit(); 
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {}
    }
  });
  resizeObserver.observe(terminal);

  let ws = null;
  let orchestratorMode = false;
  let isChatView = false;
  let currentAgentBubble = null;
  let isChatbotMode = false;

  // --- SWARM CONTROL CENTER STATE ---
  let localSwarmState = null;
  let selectedAgentId = 'manager';
  let currentSteeringTarget = 'manager';
  let currentViewMode = 'swarm'; // 'swarm' | 'terminal' | 'chat'

  const swarmContainer = document.getElementById('swarm-container');
  const swarmActiveGoal = document.getElementById('swarm-active-goal');
  const swarmTaskCounter = document.getElementById('swarm-task-counter');
  const swarmProgressFill = document.getElementById('swarm-progress-fill');
  const managerStatusBadge = document.getElementById('manager-status-badge');
  const managerThoughtText = document.getElementById('manager-thought-text');
  const swarmTabsContainer = document.getElementById('swarm-tabs-container');
  const workspaceAgentTitle = document.getElementById('workspace-agent-title');
  const workspaceAgentBadge = document.getElementById('workspace-agent-badge');
  const workspaceFeed = document.getElementById('workspace-feed');
  const btnTargetSelector = document.getElementById('btn-target-selector');
  const targetPillLabel = document.getElementById('target-pill-label');
  const goalModal = document.getElementById('goal-modal');
  const goalInputText = document.getElementById('goal-input-text');
  const btnGoalCancel = document.getElementById('btn-goal-cancel');
  const btnGoalSubmit = document.getElementById('btn-goal-submit');
  const btnSwarmNewGoal = document.getElementById('btn-swarm-new-goal');
  const btnSwarmRun = document.getElementById('btn-swarm-run');
  const btnSwarmPause = document.getElementById('btn-swarm-pause');
  const btnSwarmAuto = document.getElementById('btn-swarm-auto');

  const TARGETS = [
    { id: 'manager', label: '@Manager 👑', placeholder: 'Instruct @Manager (Antigravity)...' },
    { id: 'architect', label: '@Architect 📐', placeholder: 'Steer @Architect on system design...' },
    { id: 'coder', label: '@Coder 💻', placeholder: 'Guide @Master Coder on implementation...' },
    { id: 'evaluator', label: '@Evaluator ⚖️', placeholder: 'Ask @Evaluator about quality/tests...' },
    { id: 'tester', label: '@Tester 🧪', placeholder: 'Direct @Test Runner on test suites...' },
  ];

  function setSteeringTarget(targetId) {
    const found = TARGETS.find(t => t.id === targetId) || TARGETS[0];
    currentSteeringTarget = found.id;
    if (targetPillLabel) targetPillLabel.textContent = found.label;
    if (commandInput) commandInput.placeholder = found.placeholder;
  }

  function cycleSteeringTarget() {
    const idx = TARGETS.findIndex(t => t.id === currentSteeringTarget);
    const next = TARGETS[(idx + 1) % TARGETS.length];
    setSteeringTarget(next.id);
  }

  if (btnTargetSelector) {
    btnTargetSelector.addEventListener('click', cycleSteeringTarget);
  }

  function switchView(mode) {
    currentViewMode = mode;
    if (swarmContainer) swarmContainer.style.display = mode === 'swarm' ? 'flex' : 'none';
    if (terminal) terminal.style.display = mode === 'terminal' ? 'block' : 'none';
    if (chatContainer) chatContainer.style.display = mode === 'chat' ? 'flex' : 'none';

    btnViewToggle.textContent = mode === 'swarm' ? 'Swarm View (Active)' : (mode === 'terminal' ? 'Terminal View' : 'Chat View');
    btnViewToggle.classList.toggle('active', mode !== 'terminal');

    if (mode === 'terminal') {
      setTimeout(() => fitAddon.fit(), 50);
    }
  }

  btnViewToggle.addEventListener('click', () => {
    if (currentViewMode === 'swarm') switchView('terminal');
    else if (currentViewMode === 'terminal') switchView('chat');
    else switchView('swarm');
  });

  // Default to Swarm Control View
  switchView('swarm');

  function setStatus(status, text) {
    if (status === 'running') {
      titleBtn.style.color = '#10b981'; // Green
    } else {
      titleBtn.style.color = 'var(--danger)'; // Red
    }
  }

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setStatus('idle', 'Idle');
      appendOutput('[AgentHub] Connected to server.\n', true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          appendOutput(msg.data);
        } else 
    // Swarm Control Center Events
    if (msg.type === 'swarm-init' || msg.type === 'swarm-update') {
      if (msg.state) {
        localSwarmState = msg.state;
        renderSwarmUI();
        loadSessions();
      }
      return;
    }

    // v2 features
    if (msg.type === 'file-event') {
      const el = document.createElement('div');
      el.className = 'file-item highlight';
      el.innerText = `${msg.event}: ${msg.path}`;
      fileList.prepend(el);
      if (fileList.children.length > 50) fileList.lastChild.remove();
      setTimeout(() => el.classList.remove('highlight'), 2000);
      return;
    }

    if (msg.type === 'status') {
          setStatus(msg.status, msg.status === 'running' ? 'Running' : 'Stopped');
          if (msg.status === 'running') {
            btnSpawn.textContent = 'Stop Agent';
            btnSpawn.className = 'danger';
          } else {
            btnSpawn.textContent = 'Start Agent';
            btnSpawn.className = 'primary';
          }
          if (msg.message) {
            appendOutput(`\n[AgentHub] ${msg.message}\n`, true);
          }
        } else if (msg.type === 'error') {
          appendOutput(`\n[AgentHub Error] ${msg.message}\n`, true);
        } else if (msg.type === 'chat-chunk') {
          if (currentAgentBubble) {
            let text = msg.data;
            if (text.includes('headless mode cannot prompt for') || text.includes('no output produced')) {
              text = "\n\n⚠️ Action Required: The agent needs permission or interactive input. Please toggle the 'Auto' button ON to auto-approve, or switch to 'Terminal View' to handle the prompt manually.";
            }
            currentAgentBubble.textContent += text;
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        } else if (msg.type === 'chat-done') {
          currentAgentBubble = null;
        }
      } catch (err) {
        appendOutput(event.data);
      }
    };

    ws.onclose = () => {
      setStatus('offline', 'Offline');
      setStatus('stopped', 'Idle');
      appendOutput('\n[AgentHub] Disconnected. Reconnecting in 3s...\n', true);
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  function sendWs(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      appendOutput('\n[AgentHub] Not connected to server.\n', true);
    }
  }

  term.onData(data => {
    if (!isChatbotMode) {
      sendWs({ type: 'input', data });
    }
  });

  btnSpawn.addEventListener('click', () => {
    if (btnSpawn.textContent === 'Start Agent') {
      let command = agentSelect.value;
      
      // If it's a dynamic litellm model, run it via aider
      if (command !== 'agy' && command !== 'aider' && command !== 'bash' && command !== 'cmd') {
        command = `aider --model openai/${command} --openai-api-base http://localhost:4000/v1 --openai-api-key dummy`;
      }

      if (autoMode) {
        if (command.startsWith('agy')) command += ' --dangerously-skip-permissions';
        else if (command.startsWith('aider')) command += ' --yes';
      }
      
      term.clear();
      chatContainer.innerHTML = '';
      currentAgentBubble = null;
      
      if (isChatView) {
        if (!command.startsWith('agy')) {
          appendChatBubble(`${command} is not supported in Chat Mode yet. Please use agy or switch to Terminal View.`, false);
          return;
        }
        isChatbotMode = true;
        chatHistory = []; // No longer using history directly for API, agy handles it
        btnSpawn.textContent = 'Stop Agent';
        btnSpawn.className = 'danger';
        // Removed intro text as requested
      } else {
        isChatbotMode = false;
        sendWs({ type: 'spawn', command });
        sendWs({ type: 'resize', cols: term.cols, rows: term.rows });
      }
    } else {
      if (isChatbotMode) {
        isChatbotMode = false;
        btnSpawn.textContent = 'Start Agent';
        btnSpawn.className = 'primary';
        appendChatBubble('Chat session ended.', false);
      } else {
        sendWs({ type: 'kill' });
      }
    }
  });

  btnClear.addEventListener('click', () => {
    term.clear();
    chatContainer.innerHTML = '';
  });

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let val = commandInput.value;
    
    // Auto-inject subagent delegation instructions if Orchestrator Mode is ON
    if (orchestratorMode && val.trim()) {
      const selected = Array.from(document.querySelectorAll('.subagent-cb:checked')).map(cb => cb.value);
      if (selected.length > 0) {
        const agentInstructions = selected.map(agent => {
          if (agent === 'aider') return `- ${agent}: run \`aider --yes --message '<task>'\``;
          return `- ${agent}: run \`aider --yes --model openai/${agent} --openai-api-base http://localhost:4000/v1 --openai-api-key dummy --message '<task>'\``;
        }).join('\n');
        
        val += `\n\n[Orchestrator Instruction]: Please act as the master agent. Coordinate and delegate work to the following available subagents to fulfill the user's request. Use the exact CLI commands provided below to spawn them in the terminal. Ensure their standard output is visibly streamed to the terminal so the user can periodically monitor their progress:\n${agentInstructions}`;
      }
    }

    if (currentViewMode === 'swarm') {
      if (!val.trim()) return;
      sendWs({
        type: 'swarm-steer',
        target: currentSteeringTarget,
        message: val,
      });
      if (localSwarmState) {
        if (currentSteeringTarget === 'manager') {
          localSwarmState.manager.thread.push({ role: 'user', content: val, timestamp: Date.now() });
        } else if (localSwarmState.subagents[currentSteeringTarget]) {
          localSwarmState.subagents[currentSteeringTarget].thread.push({ role: 'user', content: val, timestamp: Date.now() });
        }
        renderWorkspaceFeed();
      }
      commandInput.value = '';
      return;
    }

    if (isChatView) {
      if (!val.trim()) return; // Ignore empty chat messages
      appendChatBubble(commandInput.value, true); // User bubble
      
      // Start a new agent bubble for this turn
      currentAgentBubble = document.createElement('div');
      currentAgentBubble.className = 'chat-bubble agent';
      chatContainer.appendChild(currentAgentBubble);
      chatContainer.scrollTop = chatContainer.scrollHeight;
      
      sendWs({ type: 'chat-turn', agent: 'agy', prompt: val, auto: autoMode });

      commandInput.value = '';
      return;
    }

    // In Terminal Mode, sending an empty form should send a raw Enter (\r)
    if (!val) {
      sendWs({ type: 'input', data: '\r' });
    } else {
      sendWs({ type: 'input', data: `${val}\r` });
    }
    commandInput.value = '';
  });

  commandInput.addEventListener('keydown', (e) => {
    if (!isChatView) {
      let sequence = null;
      if (e.key === 'ArrowUp') sequence = '\x1b[A';
      else if (e.key === 'ArrowDown') sequence = '\x1b[B';
      else if (e.key === 'ArrowRight') sequence = '\x1b[C';
      else if (e.key === 'ArrowLeft') sequence = '\x1b[D';
      else if (e.key === 'Tab') sequence = '\t';
      else if (e.key === 'g' && e.ctrlKey) sequence = '\x07';
      else if (e.key === 'c' && e.ctrlKey) sequence = '\x03';
      
      if (sequence) {
        e.preventDefault();
        sendWs({ type: 'input', data: sequence });
      }
    }
  });

  quickActionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-key');
      const parsed = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\x03/g, '\x03').replace(/\\x1b/g, '\x1b').replace(/\\t/g, '\t').replace(/\\x07/g, '\x07');
      sendWs({ type: 'input', data: parsed });
    });
  });

  // Settings modal handlers
  if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      if (apiKeyInput) apiKeyInput.focus();
    });
  }

  if (btnSettingsCancel && settingsModal) {
    btnSettingsCancel.addEventListener('click', () => {
      settingsModal.style.display = 'none';
      if (apiKeyInput) apiKeyInput.value = '';
    });
  }

  if (btnSettingsSave && settingsModal) {
    btnSettingsSave.addEventListener('click', () => {
      const key = apiKeyInput ? apiKeyInput.value.trim() : '';
      sendWs({ type: 'set-api-key', key });
      settingsModal.style.display = 'none';
      if (apiKeyInput) apiKeyInput.value = '';
    });
  }

  // Orchestrator Mode toggle
  const orchestratorPanel = document.getElementById('orchestrator-panel');
  if (btnOrchestrator && orchestratorPanel) {
    btnOrchestrator.addEventListener('click', () => {
      orchestratorMode = !orchestratorMode;
      btnOrchestrator.classList.toggle('active', orchestratorMode);
      orchestratorPanel.style.display = orchestratorMode ? 'flex' : 'none';
      appendOutput(`\n[AgentHub] Orchestrator Mode ${orchestratorMode ? 'enabled' : 'disabled'}\n`, true);
    });
  }

  const btnSelectAll = document.getElementById('btn-select-all');
  if (btnSelectAll) {
    btnSelectAll.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('.subagent-cb');
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      checkboxes.forEach(cb => cb.checked = !allChecked);
      btnSelectAll.textContent = allChecked ? 'Select All' : 'Deselect All';
    });
  }

  // Auto toggle
  let autoMode = false;
  if (btnAuto) {
    btnAuto.addEventListener('click', () => {
      autoMode = !autoMode;
      btnAuto.classList.toggle('active', autoMode);
    });
  }

  if (titleBtn && btnSpawn) {
    titleBtn.addEventListener('click', () => {
      btnSpawn.click();
    });
  }

    connect();


// --- AgentHub v2 Additions ---
let currentSessionId = Date.now().toString();
let chatHistory = [];


// Elements
const sidebar = document.getElementById('sidebar');
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle');
const btnNewSession = document.getElementById('btn-new-session');
const sessionList = document.getElementById('session-list');
const fileList = document.getElementById('file-list');

const btnPause = document.getElementById('btn-pause');

// Models Modal Elements
const modelsModal = document.getElementById('models-modal');
const btnModels = document.getElementById('btn-models');
const btnModelsCancel = document.getElementById('btn-models-cancel');
const btnModelsSave = document.getElementById('btn-models-save');

// Sidebar Toggle
if (btnSidebarToggle && sidebar) {
  btnSidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });
}

const btnSidebarClose = document.getElementById('btn-sidebar-close');
if (btnSidebarClose && sidebar) {
  btnSidebarClose.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
}

// Load Sessions (Swarm + Multi-Session Resume)
async function loadSessions() {
  if (!sessionList) return;
  try {
    const res = await fetch('/api/swarm/sessions');
    const sessions = await res.json();
    sessionList.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      sessionList.innerHTML = '<div style="padding:10px; color:#64748b; font-size:0.75rem; text-align:center;">No saved sessions</div>';
      return;
    }

    sessions.forEach(s => {
      const el = document.createElement('div');
      const isActive = localSwarmState && (localSwarmState.activeSessionId === s.id);
      el.className = `sidebar-item ${isActive ? 'active' : ''}`;
      el.style.cssText = `display:flex; flex-direction:column; gap:3px; padding:8px 10px; margin-bottom:5px; cursor:pointer; border-radius:6px; border:1px solid ${isActive ? 'var(--accent)' : 'transparent'}; background:${isActive ? 'rgba(59, 130, 246, 0.15)' : 'transparent'};`;
      
      const title = s.goal || 'Untitled Session';
      const timeStr = s.updatedAt ? new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      const statusBadge = s.totalTasks > 0
        ? `<span class="agent-status-badge ${s.completedTasks === s.totalTasks ? 'status-verified' : 'status-in_progress'}" style="font-size:0.6rem; padding:1px 5px;">${s.completedTasks}/${s.totalTasks} Verified</span>`
        : `<span class="agent-status-badge status-idle" style="font-size:0.6rem; padding:1px 5px;">Ready</span>`;

      el.innerHTML = `
        <div style="font-weight:600; font-size:0.8rem; color:${isActive ? '#38bdf8' : '#e2e8f0'}; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${title}">
          ${isActive ? '▶ ' : ''}${title}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; color:#94a3b8; margin-top:2px;">
          ${statusBadge}
          <span style="font-size:0.65rem; color:#64748b;">${dateStr} ${timeStr}</span>
        </div>
      `;

      el.onclick = async () => {
        try {
          const resp = await fetch('/api/swarm/sessions/resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: s.id })
          });
          const data = await resp.json();
          if (data.state) {
            localSwarmState = data.state;
            renderSwarmUI();
            switchView('swarm');
            loadSessions();
            appendOutput(`\n[AgentHub] Resumed session: "${s.goal}"\n`, true);
          }
        } catch (err) {
          console.error('Failed to resume session', err);
        }
        if (window.innerWidth <= 768 && sidebar) sidebar.classList.remove('open');
      };
      sessionList.appendChild(el);
    });
  } catch (e) {
    console.error('Failed to load sessions', e);
  }
}

// Save Session
async function saveSession() {
  try {
    await fetch('/api/chats', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        id: currentSessionId,
        history: chatHistory,
      })
    });
    loadSessions();
  } catch(e) {
    console.error('Failed to save session', e);
  }
}

// Render Chat
function renderChatHistory() {
  if (!chatContainer) return;
  chatContainer.innerHTML = '';
  chatHistory.forEach(msg => {
    const el = document.createElement('div');
    el.className = `chat-bubble ${msg.role}`;
    el.innerText = msg.content;
    chatContainer.appendChild(el);
  });
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// New Session Button
if (btnNewSession) {
  btnNewSession.addEventListener('click', () => {
    if (goalModal) {
      goalModal.style.display = 'flex';
      if (goalInputText) {
        goalInputText.value = '';
        goalInputText.placeholder = 'Enter engineering goal for this new session...';
        goalInputText.focus();
      }
    }
  });
}

// Models Modal Logic
if (btnModels && modelsModal) {
  btnModels.addEventListener('click', () => modelsModal.style.display = 'flex');
}
if (btnModelsCancel && modelsModal) {
  btnModelsCancel.addEventListener('click', () => modelsModal.style.display = 'none');
}
if (btnModelsSave && modelsModal) {
  btnModelsSave.addEventListener('click', async () => {
    const modelNameEl = document.getElementById('model-name');
    const modelIdEl = document.getElementById('model-id');
    const modelBaseEl = document.getElementById('model-base');
    const modelKeyEl = document.getElementById('model-key');
    const payload = {
      model_name: modelNameEl ? modelNameEl.value : '',
      model: modelIdEl ? modelIdEl.value : '',
      api_base: modelBaseEl ? modelBaseEl.value : '',
      api_key: modelKeyEl ? modelKeyEl.value : '',
    };
    await fetch('/api/models', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    modelsModal.style.display = 'none';
    alert('Model added/updated in litellm_config.yaml!');
    window.location.reload();
  });
}

// Pause Swarm (Send Ctrl+C to interrupt models)
if (btnPause) {
  btnPause.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: '\x03' }));
    }
    alert('Sent Interrupt (Ctrl+C) to active processes. This pauses active AI generation.');
  });
}

loadSessions();

// --- PC Splash Screen Logic ---
const splashScreen = document.getElementById('splash-screen');
const btnSplashContinue = document.getElementById('btn-splash-continue');
const splashQr = document.getElementById('splash-qr');
const splashUrl = document.getElementById('splash-url');

if (splashScreen) {
  splashScreen.style.display = 'none'; // Keep hidden on PC by default so UI is immediately active
}

if (btnSplashContinue && splashScreen) {
  btnSplashContinue.addEventListener('click', () => {
    splashScreen.style.display = 'none';
  });
}






// --- QR Modal Logic ---
const qrModal = document.getElementById('qr-modal');
const btnQrModal = document.getElementById('btn-qr-modal');
const btnQrClose = document.getElementById('btn-qr-close');
const modalQrImg = document.getElementById('modal-qr-img');
const modalQrUrl = document.getElementById('modal-qr-url');

const btnQrRestart = document.getElementById('btn-qr-restart');
if (btnQrRestart) {
  btnQrRestart.addEventListener('click', () => {
    btnQrRestart.innerText = 'Restarting...';
    btnQrRestart.disabled = true;
    fetch('/api/tunnel/restart', { method: 'POST' }).then(r => r.json()).then(data => {
      if (data.url) {
        modalQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.url)}`;
        modalQrUrl.innerText = data.url;
      }
      btnQrRestart.innerText = 'Restart Tunnel';
      btnQrRestart.disabled = false;
    });
  });
}


if (btnQrModal) {
  btnQrModal.addEventListener('click', () => {
    qrModal.style.display = 'flex';
    fetch('/api/tunnel').then(r => r.json()).then(data => {
      if (data.url) {
        modalQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.url)}`;
        modalQrUrl.innerText = data.url;
      }
    });
  });
}

if (btnQrClose) {
  btnQrClose.addEventListener('click', () => {
    qrModal.style.display = 'none';
  });
}

// --- SWARM CONTROL CENTER LOGIC ---
function selectAgent(agentId) {
  selectedAgentId = agentId;
  setSteeringTarget(agentId);
  renderSwarmTabs();
  renderWorkspaceFeed();
}

function renderSwarmTabs() {
  if (!swarmTabsContainer) return;
  const tabs = [
    { id: 'manager', label: '👑 Manager', icon: '👑', status: localSwarmState?.manager?.status },
    { id: 'architect', label: '📐 Architect', icon: '📐', status: localSwarmState?.subagents?.architect?.status },
    { id: 'coder', label: '💻 Master Coder', icon: '💻', status: localSwarmState?.subagents?.coder?.status },
    { id: 'evaluator', label: '⚖️ Evaluator', icon: '⚖️', status: localSwarmState?.subagents?.evaluator?.status },
    { id: 'tester', label: '🧪 Test Runner', icon: '🧪', status: localSwarmState?.subagents?.tester?.status },
  ];

  swarmTabsContainer.innerHTML = '';
  tabs.forEach(t => {
    const tabEl = document.createElement('div');
    tabEl.className = `swarm-tab ${selectedAgentId === t.id ? 'active' : ''}`;
    tabEl.dataset.agent = t.id;
    
    const statusClass = `status-${t.status || 'idle'}`;
    tabEl.innerHTML = `<span>${t.label}</span> <span class="agent-status-badge ${statusClass}" style="font-size:0.65rem;">${t.status || 'idle'}</span>`;
    
    tabEl.addEventListener('click', () => selectAgent(t.id));
    swarmTabsContainer.appendChild(tabEl);
  });
}

function renderSwarmUI() {
  if (!localSwarmState) return;

  // 1. Goal & Progress
  if (swarmActiveGoal) {
    swarmActiveGoal.textContent = localSwarmState.activeGoal || 'No active goal set';
  }
  const completed = localSwarmState.stats?.completedTasks || 0;
  const total = localSwarmState.stats?.totalTasks || 0;
  if (swarmTaskCounter) {
    swarmTaskCounter.textContent = `${completed}/${total} Verified`;
    swarmTaskCounter.className = `agent-status-badge ${completed === total && total > 0 ? 'status-verified' : 'status-in_progress'}`;
  }
  if (swarmProgressFill) {
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    swarmProgressFill.style.width = `${pct}%`;
  }

  // 2. Controls
  if (btnSwarmAuto) {
    btnSwarmAuto.textContent = `⚡ Auto-Heal: ${localSwarmState.autoApprove ? 'ON' : 'OFF'}`;
    btnSwarmAuto.classList.toggle('primary', localSwarmState.autoApprove);
  }
  if (btnSwarmRun) {
    btnSwarmRun.textContent = localSwarmState.isRunning ? 'Running...' : '▶ Run Swarm';
    btnSwarmRun.disabled = localSwarmState.isRunning;
  }

  // 3. Manager Status Card
  if (managerStatusBadge && localSwarmState.manager) {
    managerStatusBadge.textContent = localSwarmState.manager.status;
    managerStatusBadge.className = `agent-status-badge status-${localSwarmState.manager.status}`;
  }
  if (managerThoughtText && localSwarmState.manager) {
    managerThoughtText.textContent = localSwarmState.manager.currentThought;
  }

  // 4. Tabs & Workspace
  renderSwarmTabs();
  renderWorkspaceFeed();
}

function renderWorkspaceFeed() {
  if (!workspaceFeed || !localSwarmState) return;
  workspaceFeed.innerHTML = '';

  if (selectedAgentId === 'manager') {
    if (workspaceAgentTitle) workspaceAgentTitle.textContent = '👑 Manager (Antigravity) Workspace';
    if (workspaceAgentBadge && localSwarmState.manager) {
      workspaceAgentBadge.textContent = localSwarmState.manager.status;
      workspaceAgentBadge.className = `agent-status-badge status-${localSwarmState.manager.status}`;
    }

    // Section: Task Execution Graph
    const taskSection = document.createElement('div');
    taskSection.innerHTML = `<h3 style="font-size:0.9rem; color:#fff; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
      <span>📋 Swarm Task Graph (${localSwarmState.tasks?.length || 0} tasks)</span>
    </h3>`;

    if (!localSwarmState.tasks || localSwarmState.tasks.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#64748b; font-size:0.85rem; padding:16px; border:1px dashed var(--border); border-radius:8px; text-align:center;';
      empty.textContent = 'No tasks decomposed yet. Click "🎯 New Goal" to initialize the autonomous swarm task graph.';
      taskSection.appendChild(empty);
    } else {
      localSwarmState.tasks.forEach(task => {
        const card = document.createElement('div');
        card.className = `task-card ${task.status}`;
        
        let runBtnHtml = '';
        if (task.status === 'ready' || task.status === 'failed') {
          runBtnHtml = `<button class="swarm-btn primary btn-task-run" data-id="${task.id}" style="padding:3px 8px; font-size:0.75rem;">▶ Run</button>`;
        }

        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; color:white; font-size:0.85rem;">${task.title}</span>
            <div style="display:flex; gap:6px; align-items:center;">
              <span class="agent-status-badge status-${task.status}">${task.status}</span>
              ${runBtnHtml}
            </div>
          </div>
          <div style="font-size:0.8rem; color:#94a3b8;">${task.description}</div>
          <div style="font-size:0.75rem; color:#10b981;">✓ Criteria: ${task.acceptanceCriteria}</div>
          <div style="font-size:0.7rem; color:#64748b; display:flex; justify-content:space-between;">
            <span>Assigned: <strong>@${task.assignedTo}</strong></span>
            <span>Attempts: ${task.attempts || 0}/${localSwarmState.maxRetries || 3}</span>
          </div>
        `;

        const runBtn = card.querySelector('.btn-task-run');
        if (runBtn) {
          runBtn.addEventListener('click', () => {
            sendWs({ type: 'swarm-execute-task', taskId: task.id });
          });
        }

        taskSection.appendChild(card);
      });
    }
    workspaceFeed.appendChild(taskSection);

    // Section: Decisions Log
    if (localSwarmState.manager?.decisions && localSwarmState.manager.decisions.length > 0) {
      const decSection = document.createElement('div');
      decSection.innerHTML = `<h3 style="font-size:0.9rem; color:#fff; margin-top:12px; margin-bottom:8px;">🧠 Manager Strategic Decisions</h3>`;
      localSwarmState.manager.decisions.slice(-5).reverse().forEach(d => {
        const dCard = document.createElement('div');
        dCard.style.cssText = 'background:#15171e; border:1px solid var(--border); border-radius:6px; padding:8px 10px; font-size:0.8rem; color:#cbd5e1; margin-bottom:6px;';
        dCard.innerHTML = `<span style="color:#64748b; font-size:0.7rem;">${new Date(d.timestamp).toLocaleTimeString()}</span> - ${d.decision}`;
        decSection.appendChild(dCard);
      });
      workspaceFeed.appendChild(decSection);
    }

    // Section: Manager Chat Thread
    if (localSwarmState.manager?.thread && localSwarmState.manager.thread.length > 0) {
      const threadSection = document.createElement('div');
      threadSection.innerHTML = `<h3 style="font-size:0.9rem; color:#fff; margin-top:12px; margin-bottom:8px;">💬 Manager Dialogue Stream</h3>`;
      localSwarmState.manager.thread.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'agent'}`;
        bubble.innerHTML = `<div style="font-size:0.7rem; opacity:0.7; margin-bottom:2px;">${msg.role === 'user' ? 'Operator' : '👑 Manager (Antigravity)'}</div><div>${msg.content}</div>`;
        threadSection.appendChild(bubble);
      });
      workspaceFeed.appendChild(threadSection);
    }

  } else {
    // Subagent View
    const sub = localSwarmState.subagents[selectedAgentId];
    if (!sub) return;

    if (workspaceAgentTitle) workspaceAgentTitle.textContent = `${sub.icon} ${sub.name}`;
    if (workspaceAgentBadge) {
      workspaceAgentBadge.textContent = sub.status;
      workspaceAgentBadge.className = `agent-status-badge status-${sub.status}`;
    }

    const infoCard = document.createElement('div');
    infoCard.style.cssText = 'background:#15171e; border:1px solid var(--border); border-radius:8px; padding:10px 12px;';
    infoCard.innerHTML = `
      <div style="font-size:0.85rem; color:#e2e8f0; font-weight:600;">${sub.role}</div>
      <div style="font-size:0.75rem; color:#94a3b8; margin-top:4px;">Model: <code style="color:var(--accent);">${sub.model}</code></div>
      ${sub.currentTask ? `<div style="font-size:0.8rem; color:#06b6d4; margin-top:4px;">⚡ Current Task: <strong>${sub.currentTask}</strong></div>` : ''}
    `;
    workspaceFeed.appendChild(infoCard);

    // Active Live Reasoning Indicator
    if (sub.status === 'reasoning') {
      const activeCard = document.createElement('div');
      activeCard.className = 'agent-active-reasoning-card';
      activeCard.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="pulse-indicator"></span>
            <strong style="color:#38bdf8; font-size:0.9rem;">Actively Reasoning & Synthesizing Deliverable</strong>
          </div>
          <span class="agent-status-badge status-reasoning" style="font-size:0.65rem;">LIVE GENERATION</span>
        </div>
        <div style="margin-top:6px; font-size:0.8rem; color:#cbd5e1;">
          Task: <strong>${sub.currentTask || 'Executing assigned sprint objective'}</strong>
        </div>
        <div style="margin-top:3px; font-size:0.75rem; color:#94a3b8;">
          Routing: <code style="color:var(--accent);">${sub.model}</code> via LiteLLM Proxy (Port 5588) • <em>Local GPU: 0% idle</em>
        </div>
        <div class="thinking-bar-container">
          <div class="thinking-bar-fill"></div>
        </div>
        <div style="font-size:0.75rem; color:#64748b; margin-top:6px;">
          The agent is generating specifications and code. Deliverable will appear directly below as soon as complete synthesis is finished.
        </div>
      `;
      workspaceFeed.appendChild(activeCard);
    } else if (sub.status === 'evaluating') {
      const activeEvalCard = document.createElement('div');
      activeEvalCard.className = 'agent-active-eval-card';
      activeEvalCard.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="pulse-indicator-eval"></span>
          <strong style="color:#a855f7; font-size:0.9rem;">⚖️ Evaluator-Optimizer Audit In Progress</strong>
        </div>
        <div style="margin-top:4px; font-size:0.8rem; color:#cbd5e1;">
          Auditing deliverable against acceptance criteria with <code>agent-qa-engineer</code>...
        </div>
        <div class="thinking-bar-container">
          <div class="thinking-bar-fill" style="background:linear-gradient(90deg, #a855f7, #ec4899);"></div>
        </div>
      `;
      workspaceFeed.appendChild(activeEvalCard);
    }

    // Escalation / Retry Alert if Task Failed
    const failedTask = localSwarmState.tasks?.find(t => t.assignedTo === selectedAgentId && t.status === 'failed');
    if (sub.status === 'error' || failedTask) {
      const errorCard = document.createElement('div');
      errorCard.className = 'agent-active-error-card';
      errorCard.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong style="color:#ef4444; font-size:0.85rem;">⚠️ Max Retries Reached (${localSwarmState.maxRetries || 3}/${localSwarmState.maxRetries || 3})</strong>
          ${failedTask ? `<button class="swarm-btn primary btn-sub-retry" data-id="${failedTask.id}" style="padding:4px 10px; font-size:0.75rem;">🔄 Retry Task (8K Token Budget)</button>` : ''}
        </div>
        <div style="font-size:0.78rem; color:#cbd5e1; margin-top:4px;">
          Task output was previously rejected by Evaluator due to output truncation (token limit). Token budget has been upgraded to 8K. Click retry to run again.
        </div>
      `;
      const retryBtn = errorCard.querySelector('.btn-sub-retry');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          sendWs({ type: 'swarm-execute-task', taskId: retryBtn.dataset.id });
        });
      }
      workspaceFeed.appendChild(errorCard);
    }

    // Evaluator Quality Audits relevant to this agent
    const relevantEvals = (localSwarmState.subagents?.evaluator?.evaluations || []).filter(ev => {
      if (selectedAgentId === 'evaluator') return true;
      const t = localSwarmState.tasks?.find(tsk => tsk.id === ev.taskId);
      return t && t.assignedTo === selectedAgentId;
    });

    if (relevantEvals.length > 0) {
      const evalSection = document.createElement('div');
      evalSection.innerHTML = `<h3 style="font-size:0.9rem; color:#fff; margin-top:10px; margin-bottom:6px;">⚖️ Evaluator Quality Audits (${relevantEvals.length})</h3>`;
      relevantEvals.slice(-5).reverse().forEach(ev => {
        const sc = document.createElement('div');
        sc.style.cssText = `background:#15171e; border:1px solid ${ev.passed ? 'rgba(16, 185, 129, 0.4)' : 'rgba(239, 68, 68, 0.4)'}; border-radius:8px; padding:8px 10px; font-size:0.8rem; margin-bottom:6px;`;
        sc.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; color:${ev.passed ? '#10b981' : '#ef4444'};">${ev.passed ? 'PASSED ✓' : 'REJECTED ✗'} (Score: ${ev.score}/100)</span>
            <span style="font-size:0.7rem; color:#64748b;">${new Date(ev.timestamp).toLocaleTimeString()} • ${ev.taskId}</span>
          </div>
          <div style="color:#cbd5e1; margin-top:4px; font-size:0.78rem;">${ev.diagnosticFeedback}</div>
        `;
        evalSection.appendChild(sc);
      });
      workspaceFeed.appendChild(evalSection);
    }

    // Subagent Thread
    if (sub.thread && sub.thread.length > 0) {
      const threadSection = document.createElement('div');
      threadSection.innerHTML = `<h3 style="font-size:0.9rem; color:#fff; margin-top:10px; margin-bottom:6px;">💬 Agent Deliverable History (${sub.thread.length})</h3>`;
      sub.thread.forEach((msg, idx) => {
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'agent'}`;
        const attemptLabel = msg.taskId ? ` • Attempt ${idx + 1}` : '';
        bubble.innerHTML = `
          <div style="font-size:0.7rem; opacity:0.7; margin-bottom:2px; display:flex; justify-content:space-between;">
            <span>${msg.role === 'user' ? 'Operator Directive' : sub.name + attemptLabel}</span>
            <span>${msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}</span>
          </div>
          <div style="white-space:pre-wrap; font-family:monospace; font-size:0.85rem; max-height:400px; overflow-y:auto; background:#121317; padding:8px; border-radius:6px; margin-top:4px;">${msg.content}</div>
        `;
        threadSection.appendChild(bubble);
      });
      workspaceFeed.appendChild(threadSection);
    } else if (sub.status !== 'reasoning') {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#64748b; font-size:0.85rem; padding:16px; text-align:center; font-style:italic;';
      empty.textContent = `No messages or outputs for ${sub.name} yet. Direct an instruction below to steer this subagent.`;
      workspaceFeed.appendChild(empty);
    }
  }

  if (selectedAgentId === 'manager') {
    workspaceFeed.scrollTop = 0; // Keep task graph front and center
  } else {
    workspaceFeed.scrollTop = workspaceFeed.scrollHeight;
  }
}

// Swarm Button Listeners
if (btnSwarmNewGoal) {
  btnSwarmNewGoal.addEventListener('click', () => {
    if (goalModal) {
      goalModal.style.display = 'flex';
      if (goalInputText) goalInputText.focus();
    }
  });
}

if (btnGoalCancel) {
  btnGoalCancel.addEventListener('click', () => {
    if (goalModal) goalModal.style.display = 'none';
  });
}

if (btnGoalSubmit) {
  btnGoalSubmit.addEventListener('click', () => {
    const goalText = goalInputText ? goalInputText.value.trim() : '';
    if (!goalText) return;
    sendWs({ type: 'swarm-set-goal', goal: goalText });
    if (goalModal) goalModal.style.display = 'none';
    if (goalInputText) goalInputText.value = '';
  });
}

if (btnSwarmRun) {
  btnSwarmRun.addEventListener('click', () => {
    sendWs({ type: 'swarm-run' });
  });
}

if (btnSwarmPause) {
  btnSwarmPause.addEventListener('click', () => {
    sendWs({ type: 'swarm-pause' });
  });
}

if (btnSwarmAuto) {
  btnSwarmAuto.addEventListener('click', () => {
    const nextAuto = !Boolean(localSwarmState?.autoApprove);
    sendWs({ type: 'swarm-set-auto', auto: nextAuto });
  });
}

// Fetch initial state via REST immediately on page load
fetch('/api/swarm/state')
  .then(r => r.json())
  .then(st => {
    localSwarmState = st;
    renderSwarmUI();
  })
  .catch(() => {});

})();
