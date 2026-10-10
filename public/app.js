(() => {
  const wsBadge = document.getElementById('ws-badge');
  const procBadge = document.getElementById('proc-badge');
  const terminal = document.getElementById('terminal-container');
  const agentSelect = document.getElementById('agent-select');
  const btnSpawn = document.getElementById('btn-spawn');
  const btnStop = document.getElementById('btn-stop');
  const btnClear = document.getElementById('btn-clear');
  const btnSettings = document.getElementById('btn-settings');
  const btnOrchestrator = document.getElementById('btn-orchestrator');
  const inputForm = document.getElementById('input-form');
  const commandInput = document.getElementById('command-input');
  const quickActionBtns = document.querySelectorAll('.quick-actions button');
  const settingsModal = document.getElementById('settings-modal');
  const apiKeyInput = document.getElementById('api-key-input');
  const btnSettingsCancel = document.getElementById('btn-settings-cancel');
  const btnSettingsSave = document.getElementById('btn-settings-save');

  let ws = null;
  let orchestratorMode = false;

  function appendOutput(text) {
    terminal.textContent += text;
    terminal.scrollTop = terminal.scrollHeight;
  }

  function setStatus(status, text) {
    procBadge.textContent = text || status;
    if (status === 'running') {
      procBadge.className = 'badge running';
    } else {
      procBadge.className = 'badge';
    }
  }

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsBadge.textContent = 'Connected';
      wsBadge.className = 'badge connected';
      appendOutput('[AgentHub] Connected to server.\n');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output') {
          appendOutput(msg.data);
        } else if (msg.type === 'status') {
          setStatus(msg.status, msg.status === 'running' ? 'Running' : 'Stopped');
          if (msg.message) {
            appendOutput(`\n[AgentHub] ${msg.message}\n`);
          }
        } else if (msg.type === 'error') {
          appendOutput(`\n[AgentHub Error] ${msg.message}\n`);
        }
      } catch (err) {
        appendOutput(event.data);
      }
    };

    ws.onclose = () => {
      wsBadge.textContent = 'Disconnected';
      wsBadge.className = 'badge';
      setStatus('stopped', 'Idle');
      appendOutput('\n[AgentHub] Disconnected. Reconnecting in 3s...\n');
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
      appendOutput('\n[AgentHub] Not connected to server.\n');
    }
  }

  btnSpawn.addEventListener('click', () => {
    const command = agentSelect.value;
    sendWs({ type: 'spawn', command });
  });

  btnStop.addEventListener('click', () => {
    sendWs({ type: 'kill' });
  });

  btnClear.addEventListener('click', () => {
    terminal.textContent = '';
  });

  inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = commandInput.value;
    sendWs({ type: 'input', data: `${val}\n` });
    commandInput.value = '';
  });

  quickActionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-key');
      const parsed = raw.replace('\\n', '\n').replace('\\x03', '\x03');
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
  btnOrchestrator.addEventListener('click', () => {
    orchestratorMode = !orchestratorMode;
    btnOrchestrator.classList.toggle('active', orchestratorMode);
    appendOutput(`[AgentHub] Orchestrator Mode ${orchestratorMode ? 'enabled' : 'disabled'}\n`);
  });

  connect();
})();
