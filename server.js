const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const localtunnel = require('localtunnel');

const PORT = process.env.PORT || 3000;
const app = express();

// Serve static frontend files from public/
app.use(express.static(path.join(__dirname, 'public')));

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

    try {
      runningProcess = spawn(cmdToRun, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
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
