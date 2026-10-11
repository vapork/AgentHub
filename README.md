# AgentHub: The Mobile-First AI Swarm Control Center 📱🤖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

AgentHub is a lightweight, one-click orchestrator that lets you remotely manage, monitor, and chat with terminal-based AI agents (like **Aider**, **agy**, and custom **Swarms**) directly from your smartphone or desktop. 

## 🛑 Why We Built This (The Pain We Faced)

If you've ever tried to build a seamless, remote-accessible AI coding environment, you've probably felt the friction. The standard approaches are often incredibly bloated and fundamentally flawed:

- **The Overcomplicated Stack:** Trying to stitch together **Tailscale** for remote network access, **cli4api** for CLI endpoints (which completely fails at streaming real-time outputs), and **OpenWebUI** for a frontend interface is simply too complicated. Even after hours of wrestling with configuration files, *this stack still does not achieve our goals* of low-latency, mobile-first, real-time agent orchestration.
- **The Networking Nightmare:** Setting up Tailscale or complex VPNs across multiple devices just to check if your AI agent finished a codebase refactor while you're away from your desk.
- **Heavy, Bloated UIs:** Installing massive Dockerized solutions like OpenWebUI when all you really want is a lightweight, familiar chat wrapper around your raw terminal tools.
- **Terminal Paralysis on Mobile:** Running **Aider** or multi-agent Swarms in a terminal is incredibly powerful on a desktop, but reading and scrolling through raw PTY outputs on a mobile screen is practically impossible.

## 💡 The AgentHub Solution

We built AgentHub to bypass that entire messy ecosystem. AgentHub gives you a powerful "All-In-One" wrapper that *just works*.

**Key Features:**
- **Zero-Config Remote Access:** No Tailscale required. AgentHub automatically spins up a secure `localtunnel` and generates a QR code. Scan it with your phone, and you instantly have full control over your desktop agents from anywhere.
- **Built-in API Proxy:** Forget setting up standalone proxy servers. AgentHub includes a built-in Express proxy for OpenAI/LiteLLM requests, safely routing your API keys without exposing them to the raw agent environments.
- **Dual-Mode Interface:** 
  - **Chat View:** A familiar, messaging-style interface perfectly optimized for mobile, streaming your agent's thoughts in real-time.
  - **Terminal View:** Toggle back to a raw `xterm.js` view whenever you need low-level PTY control.
- **Orchestrator Mode:** Easily spawn and delegate tasks to a swarm of sub-agents simultaneously from one screen.
- **Auto-Approve Toggle:** Hit the "Auto" button to seamlessly skip permission prompts for fully autonomous operation while you grab a coffee.

## ⚙️ Prerequisites

AgentHub is an orchestrator wrapper. It assumes your core AI tools are already installed on your machine. Before running AgentHub, make sure you have installed:
- **[Aider](https://aider.chat/)**: The core AI pair programming agent.
- **[LiteLLM](https://github.com/BerriAI/litellm)** (Optional but recommended): If you plan to route requests to multiple local or cloud LLM providers.

### 💻 Our Extremely Lightweight, Free AI Setup
We built AgentHub to be efficient. Using LiteLLM, we route AgentHub's traffic to a mix of completely free APIs and a highly optimized local model. 

Here is our exact setup for achieving top-tier reasoning without paying for API credits:

**1. Our Local Hardware (100% Free & Private):**
- **Prism Bonsai 2 (1-bit, 27B)**: We run this model locally. Thanks to its 1-bit quantization, this massive 27B model fits perfectly into the 8GB VRAM of a standard **NVIDIA RTX 4060** while still maintaining a full 16k context window!

**2. Our Cloud Fallbacks (Generous Free Tiers via LiteLLM):**
- **Gemini (`gemini/gemini-3.8-flash`)**: Accessed via Google AI Studio for massive context windows at zero cost.
- **Groq (`groq/llama-3.3-70b-versatile`)**: Used for blistering fast, free LLaMA 3.3 inference.
- **GLM-4 (`openai/glm-4.7-flash`)**: An excellent, highly capable fallback model available for free.
- **Nemotron 3 Super (`openrouter/nvidia/nemotron-3-super-120b-a12b:free`)**: Accessed via OpenRouter. *Pro-tip: If you add just $10 to your OpenRouter account balance, you unlock up to 1,000 free requests a day for this massive 120B NVIDIA model!*

## 🚀 Quick Setup

In just ~1,400 lines of highly-optimized code, you get the entire backend server, WebSocket real-time routing, PTY spawning, and mobile frontend.

1. Clone this repository.
2. Run `npm install` to install the lightweight dependencies (`express`, `ws`, `node-pty`, `localtunnel`, etc.).
3. Run `node server.js` to launch the hub.
4. Open `http://localhost:3333` on your desktop.
5. Click the **📱 QR** button in the sidebar and scan it with your phone!

## 📂 Codebase Overview
- `server.js`: The Express backend, WebSocket handler, PTY spawner, and API proxy.
- `public/index.html`: The mobile-responsive, dual-mode UI layout.
- `public/app.js`: Frontend logic, terminal integration, and UI events.
