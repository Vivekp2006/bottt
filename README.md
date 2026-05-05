# Semiquantum Bot

UI-driven WhatsApp bot controller built on Baileys. Includes a browser dashboard for pairing, logs, bot management, and configuration.

## Features
- Web UI for bot lifecycle (start/stop/remove)
- QR display in browser
- Live logs via server-sent events
- Role and config editing from UI
- Manual message send

## Requirements
- Node.js 18+ recommended
- A machine that can run Baileys (VPS or local machine)

## Setup
```bash
npm install
node bot.mjs
```

Open the UI at:
```
http://localhost:8787
```

## Environment
Create a `.env` file:
```
UI_USERNAME=your_username
UI_PASSWORD=your_password
UI_ORIGIN=https://your-ui-domain.pages.dev
```

## Cloudflare Pages (UI)
- Deploy the `ui/` folder as a static site.
- No build command.
- Output directory: `ui`.

## Backend Hosting
Run `node bot.mjs` on your VPS or local machine. Point the UI API base to that server.

## Notes
- `.env`, `auth/`, `data/`, and `node_modules/` are ignored by git.
