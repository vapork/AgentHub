const http = require('http');
const path = require('path');
const pty = require('node-pty');
const express = require('express');
const { WebSocketServer } = require('ws');
const localtunnel = require('localtunnel');
const fs = require('fs');
const os = require('os');
const chokidar = require('chokidar');
const yaml = require('yaml');
const qrcode = require('qrcode-terminal');

const PORT = process.env.PORT || 3333;
const app = express();

// Global variable to store the OpenAI API key (set via Settings modal)
let openaiApiKey = process.env.OPENAI_API_KEY || '';

// Serve static frontend files from public/
app.use(express.static(path.join(__dirname, 'public')));

// Add OpenAI-compatible proxy endpoint
app.post('/v1/chat/completions', express.json(), async (req, res) => {
  if (!openaiApiKey) {
    return res.status(401).json({ error: 'OpenAI API key not configured. Please set it in Settings.' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify(req.body)
    });

    if (!response.ok) {
      const errorData = await response.json();
      return res.status(response.status).json(errorData);
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Internal proxy error' });
  }
});

// Add API endpoint to read litellm models dynamically
app.get('/api/models', (req, res) => {
  const fs = require('fs');
  const os = require('os');
  const yamlPath = path.join(os.homedir(), 'litellm_config.yaml');
  try {
    if (fs.existsSync(yamlPath)) {
      const content = fs.readFileSync(yamlPath, 'utf-8');
      const models = [];
      const regex = /- model_name:\s+([^\s]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        models.push(match[1]);
      }
      res.json({ models });
    } else {
      res.json({ models: [] });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create HTTP server

// --- CHATS HISTORY API ---


let currentTunnel = null;
let globalTunnelUrl = '';

async function startLocaltunnel() {
  if (currentTunnel) {
    try { currentTunnel.close(); } catch(e){}
  }
  try {
    currentTunnel = await localtunnel({ port: PORT });
    globalTunnelUrl = currentTunnel.url;
    console.log(`\n\x1b[36m[*] Tunnel active at:\x1b[0m ${currentTunnel.url}\n`);
    currentTunnel.on('close', () => console.log('Localtunnel closed.'));
    currentTunnel.on('error', err => console.error('Localtunnel error:', err));
  } catch (err) {
    console.error('Failed to initialize localtunnel:', err.message);
  }
}

app.get('/api/tunnel', (req, res) => res.json({ url: globalTunnelUrl }));
app.post('/api/tunnel/restart', async (req, res) => {
  await startLocaltunnel();
  res.json({ url: globalTunnelUrl });
});


const CHATS_FILE = path.join(__dirname, 'chats.json');

app.get('/api/chats', (req, res) => {
  try {
    if (fs.existsSync(CHATS_FILE)) {
      const data = fs.readFileSync(CHATS_FILE, 'utf8');
      res.json(JSON.parse(data));
    } else {
      res.json([]);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/chats', express.json(), (req, res) => {
  try {
    let chats = [];
    if (fs.existsSync(CHATS_FILE)) {
      chats = JSON.parse(fs.readFileSync(CHATS_FILE, 'utf8'));
    }
    const newSession = req.body;
    // Update if exists, else add
    const index = chats.findIndex(c => c.id === newSession.id);
    if (index >= 0) {
      chats[index] = newSession;
    } else {
      chats.push(newSession);
    }
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- LITELLM CONFIG WRITER API ---
const YAML_PATH = path.join(os.homedir(), 'litellm_config.yaml');

app.post('/api/models', express.json(), (req, res) => {
  try {
    const { model_name, api_base, api_key, model } = req.body;
    let configStr = '';
    if (fs.existsSync(YAML_PATH)) {
      configStr = fs.readFileSync(YAML_PATH, 'utf8');
    }
    let config = yaml.parse(configStr) || {};
    if (!config.model_list) config.model_list = [];
    
    // Check if exists
    const idx = config.model_list.findIndex(m => m.model_name === model_name);
    const newEntry = {
      model_name,
      litellm_params: {
        model: model || 'openai/local-model',
        api_base: api_base || 'http://localhost:11434/v1',
        api_key: api_key || 'not-needed'
      }
    };
    if (idx >= 0) {
      config.model_list[idx] = newEntry;
    } else {
      config.model_list.push(newEntry);
    }
    
    fs.writeFileSync(YAML_PATH, yaml.stringify(config));
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});


const server = http.createServer(app);

// Attach WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let runningProcess = null;

  const send = (payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const killCurrentProcess = () => {
    if (runningProcess) {
      try {
        runningProcess.kill();
      } catch (err) {
        // ignore errors on kill
      }
      runningProcess = null;
    }
  };

  const spawnProcess = (commandStr) => {
    killCurrentProcess();

    const cmdToRun = (commandStr && commandStr.trim()) || (process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : (process.env.SHELL || '/bin/sh'));

    // Only use the built-in proxy if the user explicitly provided an API key in the UI
    const env = { ...process.env };
    if (openaiApiKey && openaiApiKey !== process.env.OPENAI_API_KEY) {
      env.OPENAI_API_BASE = 'http://localhost:3000/v1';
      env.OPENAI_API_KEY = 'agenthub-dummy';
    }

    try {
      runningProcess = pty.spawn(process.platform === 'win32' ? 'cmd.exe' : (process.env.SHELL || '/bin/sh'), 
        process.platform === 'win32' ? ['/c', cmdToRun] : ['-c', cmdToRun], {
        name: 'xterm-color',
        cols: 80,
        rows: 30,
        cwd: process.cwd(),
        env: env
      });

      send({ type: 'status', status: 'running', message: `Started: ${cmdToRun}` });

      runningProcess.on('data', (data) => {
        send({ type: 'output', data: data });
      });

      runningProcess.on('exit', (code) => {
        send({ type: 'status', status: 'stopped', code, message: `Process exited with code ${code}` });
        runningProcess = null;
      });
    } catch (err) {
      send({ type: 'error', message: `Failed to spawn: ${err.message}` });
    }
  };

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.type === 'spawn') {
        spawnProcess(msg.command);
      } else if (msg.type === 'input') {
        if (runningProcess) {
          runningProcess.write(msg.data);
        } else {
          send({ type: 'error', message: 'No active process to receive input' });
        }
      } else if (msg.type === 'kill') {
        killCurrentProcess();
        send({ type: 'status', status: 'stopped', message: 'Process terminated by user' });
      } else if (msg.type === 'set-api-key') {
        // Update the global API key from the Settings modal
        openaiApiKey = msg.key || '';
        send({ type: 'status', status: 'stopped', message: `API key ${openaiApiKey ? 'set' : 'cleared'}` });
      } else if (msg.type === 'resize') {
        if (runningProcess) {
          try {
            runningProcess.resize(msg.cols, msg.rows);
          } catch(e) {}
        }
      } else if (msg.type === 'chat-turn') {
        const { spawn: rawSpawn } = require('child_process');
        // Spawn non-interactive agy in the background
        const env = { ...process.env };
        if (openaiApiKey && openaiApiKey !== process.env.OPENAI_API_KEY) {
          env.OPENAI_API_BASE = 'http://localhost:3000/v1';
          env.OPENAI_API_KEY = 'agenthub-dummy';
        }
        
        try {
          const args = ['-p', msg.prompt, '-c'];
          if (msg.auto) args.push('--dangerously-skip-permissions');
          const p = rawSpawn('agy', args, { env, shell: false });
          p.stdout.on('data', d => send({ type: 'chat-chunk', data: d.toString() }));
          p.stderr.on('data', d => send({ type: 'chat-chunk', data: d.toString() }));
          p.on('close', () => send({ type: 'chat-done' }));
        } catch (e) {
          send({ type: 'error', message: 'Failed to spawn chat turn: ' + e.message });
        }
      }
    } catch (err) {
      send({ type: 'error', message: `Invalid message format: ${err.message}` });
    }
  });

  ws.on('close', () => {
    killCurrentProcess();
  });
});

// --- FILE WATCHER ---
const watcher = chokidar.watch(process.cwd(), {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: true,
  depth: 3
});

const broadcastFileEvent = (event, filePath) => {
  const relativePath = path.relative(process.cwd(), filePath);
  wss.clients.forEach(client => {
    if (client.readyState === 1) { // 1 = OPEN
      client.send(JSON.stringify({ type: 'file-event', event, path: relativePath }));
    }
  });
};

watcher
  .on('add', p => broadcastFileEvent('add', p))
  .on('change', p => broadcastFileEvent('change', p))
  .on('unlink', p => broadcastFileEvent('unlink', p));


// Start HTTP server & localtunnel
server.listen(PORT, async () => {
  console.log(`Local server listening on http://localhost:${PORT}`);

  try { await startLocaltunnel(); } catch (err) {
    console.error('Failed to initialize localtunnel:', err.message);
  }
});
