# AgentHub

AgentHub is a mobile-first, one-click AI swarm control center. It allows you to remotely manage, orchestrate, and chat with AI agents (like `agy` and `aider`) from your smartphone or desktop.

## Problem Statement

Interacting with complex, terminal-based AI coding agents often requires sitting in front of a desktop and manually running CLI commands. There was a need for a seamless, mobile-friendly interface to remotely monitor, orchestrate, and converse with these agents on-the-go, without losing access to the raw terminal output or the ability to securely proxy API requests.

## Solution

AgentHub solves this by providing a lightweight Node.js backend and an interactive web frontend. 

**Key Features:**
- **Remote Mobile Access:** Automatically creates a secure `localtunnel` and generates a QR code. Scan the code to control your agents from anywhere.
- **Terminal & Chat Views:** Toggle between a raw `xterm.js` terminal view (for full control) and a Chat View (for a familiar, messaging-style interface).
- **Orchestrator Mode:** Easily delegate tasks to a swarm of subagents simultaneously.
- **Auto-Approve:** Toggle "Auto" to seamlessly skip permission prompts for fully autonomous operation.
- **API Proxy:** Built-in proxy for OpenAI API requests to safely route your API keys without exposing them to the agent environments directly.
- **Session Management:** Save and load your chat histories.

## Setup & Execution

1. Run `npm install` to install dependencies (`express`, `ws`, `node-pty`, `localtunnel`, `chokidar`, `yaml`, etc.).
2. Run `node server.js` to start the server.
3. Open `http://localhost:3333` on your desktop.
4. Click the **📱 QR** button and scan it with your phone to access AgentHub remotely.

## Codebase Overview
The entire solution is lightweight and self-contained in ~1,400 lines of code:
- `server.js` (Backend server, WebSocket handler, PTY spawner, API proxy)
- `public/index.html` (Mobile-responsive UI layout)
- `public/app.js` (Frontend logic, terminal integration, UI events)
