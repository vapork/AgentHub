Goal: Upgrade AgentHub to include a built-in LLM proxy and an improved UI.

1. Backend Proxy (server.js):
- Add the 'http-proxy-middleware' or just use standard 'fetch' (since Node 18+) to implement a POST /v1/chat/completions endpoint.
- This endpoint should act as an OpenAI-compatible proxy. It receives requests from the spawned agents, and forwards them to the real OpenAI API (https://api.openai.com/v1/chat/completions).
- Read the real API key from process.env.OPENAI_API_KEY.

2. UI Improvements (public/index.html & app.js):
- Make the UI look more professional, modern, and sleek (dark theme, glassmorphism, or clean minimalist layout).
- Add a visual 'Orchestrator Mode' toggle or indicator.
- Create a Settings modal where users can input their API keys (which gets sent to the server via WebSocket to be stored in memory for the proxy to use).

3. Agent Spawning update:
- When spawning agents via WebSocket, inject OPENAI_API_BASE=http://localhost:3000/v1 and OPENAI_API_KEY=agenthub-dummy into their environment variables so they route through our proxy automatically.

Implement these changes across server.js, public/index.html, and public/app.js. Make sure the server still works and localtunnel still connects.
