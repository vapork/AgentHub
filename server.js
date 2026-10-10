const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const localtunnel = require('localtunnel');

const PORT = process.env.PORT || 3000;
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

// Create HTTP server
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

    // Inject environment variables for the proxy
    const env = {
      ...process.env,
      OPENAI_API_BASE: 'http://localhost:3000/v1',
      OPENAI_API_KEY: 'agenthub-dummy'
    };

    try {
      runningProcess = spawn(cmdToRun, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env
      });

      send({ type: 'status', status: 'running', message: `Started: ${cmdToRun}` });

      runningProcess.stdout.on('data', (data) => {
        send({ type: 'output', data: data.toString() });
      });

      runningProcess.stderr.on('data', (data) => {
        send({ type: 'output', data: data.toString() });
      });

      runningProcess.on('error', (err) => {
        send({ type: 'error', message: `Process error: ${err.message}` });
      });

      runningProcess.on('close', (code) => {
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
        if (runningProcess && runningProcess.stdin && runningProcess.stdin.writable) {
          runningProcess.stdin.write(msg.data);
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
      }
    } catch (err) {
      send({ type: 'error', message: `Invalid message format: ${err.message}` });
    }
  });

  ws.on('close', () => {
    killCurrentProcess();
  });
});

// Start HTTP server & localtunnel
server.listen(PORT, async () => {
  console.log(`Local server listening on http://localhost:${PORT}`);

  try {
    const tunnel = await localtunnel({ port: PORT, subdomain: 'agenthub' });
    console.log(`👉 Access AgentHub at: ${tunnel.url}`);

    tunnel.on('close', () => {
      console.log('Localtunnel closed.');
    });

    tunnel.on('error', (err) => {
      console.error('Localtunnel error:', err);
    });
  } catch (err) {
    console.error('Failed to initialize localtunnel:', err.message);
  }
});
