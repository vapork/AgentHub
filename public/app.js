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
  

  function appendChatBubble(text, isUser) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isUser ? 'user' : 'agent'}`;
    bubble.textContent = text;
    chatContainer.appendChild(bubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    if (typeof chatHistory !== 'undefined') {
      chatHistory.push({ role: isUser ? 'user' : 'agent', content: text });
      if (typeof saveSession === 'function') saveSession();
    }
  }

  function appendOutput(text, isSystem = false) {
    // PTY output only goes to Terminal View!
    if (isSystem) {
      term.write(`\r\n\x1b[33m${text}\x1b[0m\r\n`);
    } else {
      term.write(text);
      // v2 feature: parse cost
      

    }
  }

  btnViewToggle.addEventListener('click', () => {
    isChatView = !isChatView;
    btnViewToggle.classList.toggle('active', isChatView);
    if (isChatView) {
      terminal.style.display = 'none';
      chatContainer.style.display = 'flex';
      agentSelect.style.display = 'none';
      btnSpawn.style.display = 'none';
      chatContainer.scrollTop = chatContainer.scrollHeight;
    } else {
      terminal.style.display = 'block';
      chatContainer.style.display = 'none';
      agentSelect.style.display = 'inline-block';
      btnSpawn.style.display = 'inline-block';
      setTimeout(() => fitAddon.fit(), 50);
    }
  });

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
  btnSettings.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
    apiKeyInput.focus();
  });

  btnSettingsCancel.addEventListener('click', () => {
    settingsModal.style.display = 'none';
    apiKeyInput.value = '';
  });

  btnSettingsSave.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    sendWs({ type: 'set-api-key', key });
    settingsModal.style.display = 'none';
    apiKeyInput.value = '';
  });

  // Orchestrator Mode toggle
  const orchestratorPanel = document.getElementById('orchestrator-panel');
  btnOrchestrator.addEventListener('click', () => {
    orchestratorMode = !orchestratorMode;
    btnOrchestrator.classList.toggle('active', orchestratorMode);
    orchestratorPanel.style.display = orchestratorMode ? 'flex' : 'none';
    appendOutput(`\n[AgentHub] Orchestrator Mode ${orchestratorMode ? 'enabled' : 'disabled'}\n`, true);
  });

  const btnSelectAll = document.getElementById('btn-select-all');
  btnSelectAll.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.subagent-cb');
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    btnSelectAll.textContent = allChecked ? 'Select All' : 'Deselect All';
  });

  // Auto toggle
  let autoMode = false;
  btnAuto.addEventListener('click', () => {
    autoMode = !autoMode;
    btnAuto.classList.toggle('active', autoMode);
  });

  
  if (titleBtn) {
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
btnSidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('open');
});


const btnSidebarClose = document.getElementById('btn-sidebar-close');
if (btnSidebarClose) {
  btnSidebarClose.addEventListener('click', () => {
    sidebar.classList.remove('open');
  });
}

// Load Sessions
async function loadSessions() {
  try {
    const res = await fetch('/api/chats');
    const sessions = await res.json();
    sessionList.innerHTML = '';
    sessions.forEach(s => {
      const el = document.createElement('div');
      el.className = 'sidebar-item';
      el.innerText = `Session ${new Date(parseInt(s.id)).toLocaleTimeString()}`;
      el.onclick = () => {
        currentSessionId = s.id;
        chatHistory = s.history || [];
        
        
        renderChatHistory();
        if (window.innerWidth <= 768) sidebar.classList.remove('open');
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
  chatContainer.innerHTML = '';
  chatHistory.forEach(msg => {
    const el = document.createElement('div');
    el.className = `chat-bubble ${msg.role}`;
    el.innerText = msg.content;
    chatContainer.appendChild(el);
  });
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// New Session
btnNewSession.addEventListener('click', () => {
  currentSessionId = Date.now().toString();
  chatHistory = [];
  
  
  renderChatHistory();
  term.clear();
});


// Models Modal Logic
btnModels.addEventListener('click', () => modelsModal.style.display = 'flex');
btnModelsCancel.addEventListener('click', () => modelsModal.style.display = 'none');
btnModelsSave.addEventListener('click', async () => {
  const payload = {
    model_name: document.getElementById('model-name').value,
    model: document.getElementById('model-id').value,
    api_base: document.getElementById('model-base').value,
    api_key: document.getElementById('model-key').value,
  };
  await fetch('/api/models', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(payload)
  });
  modelsModal.style.display = 'none';
  alert('Model added/updated in litellm_config.yaml!');
  window.location.reload(); // reload to fetch new models
});

// Pause Swarm (Send Ctrl+C to interrupt models)
btnPause.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'input', data: '\x03' })); // Ctrl+C
  alert('Sent Interrupt (Ctrl+C) to active processes. This pauses active AI generation.');
});

// Intercept Chat View additions to save history
// removed bad patch line

loadSessions();


// --- PC Splash Screen Logic ---
const splashScreen = document.getElementById('splash-screen');
const btnSplashContinue = document.getElementById('btn-splash-continue');
const splashQr = document.getElementById('splash-qr');
const splashUrl = document.getElementById('splash-url');

if (window.innerWidth > 768) {
  splashScreen.style.display = 'flex';
  
  // Fetch Tunnel URL
  fetch('/api/tunnel').then(r => r.json()).then(data => {
    if (data.url) {
      splashQr.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(data.url)}`;
      splashUrl.innerText = data.url;
    }
  });
}

btnSplashContinue.addEventListener('click', () => {
  splashScreen.style.display = 'none';
});






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
  
  btnQrClose.addEventListener('click', () => {
    qrModal.style.display = 'none';
  });
}

})();
