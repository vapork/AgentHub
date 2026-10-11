# AgentHub Architecture

## Goal
Build a zero-configuration "Remote AI Control Center" that allows a user to securely access their local terminal agents (like Agy and Aider) from a mobile phone browser. Later, this will be wrapped into a native Android app.

## Tech Stack
- **Backend:** Node.js, Express, `ws` (WebSockets)
- **Tunneling:** `localtunnel` (to expose the local server securely over the internet without port forwarding)
- **Frontend:** Vanilla HTML/JS/CSS served by Express from the `public/` directory.

## Requirements

### 1. The Server (`server.js`)
- Host an Express HTTP server on port 3000 that serves static files from `public/`.
- Once the server starts, programmatically start a `localtunnel` on port 3000 to get a public HTTPS URL and print it to the console (e.g., `👉 Access AgentHub at: https://...`).
- Attach a WebSocket server (`ws`) to the HTTP server.
- When a WebSocket client connects, provide an API for them to:
  a. Spawn a terminal process (e.g., `cmd.exe`, `aider`, or `agy`).
  b. Listen to `stdout` and `stderr` of the spawned process and broadcast it back to the WebSocket client.
  c. Receive text input from the WebSocket client and write it to the `stdin` of the spawned process (this is critical so the user can approve Y/N prompts remotely).

### 2. The Frontend (`public/index.html` & `public/app.js`)
- A mobile-friendly web UI.
- An input field to type terminal commands or agent prompts.
- A large, scrollable "terminal" text area that displays the live output (WebSocket messages) arriving from the server.
- The ability to send keyboard input back through the WebSocket to answer interactive prompts (like pressing 'Y' and Enter).

## Next Steps for Aider
Please read these requirements and create:
1. `server.js`
2. `public/index.html`
3. `public/app.js` (if you prefer to separate the frontend JS)
4. Update `package.json` so that `npm start` runs `node server.js`.
