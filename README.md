# Code Review AI

A production-grade AI code reviewer built on Cloudflare's developer platform. Paste any code snippet and get a structured review covering typos, security vulnerabilities, production readiness, and code quality — with memory that persists across sessions.

**Live demo:** https://my-agent.srijaakula34.workers.dev

---

## What it does

The agent runs every submission through a **5-pass analysis framework**:

| Pass | What it checks |
|------|---------------|
| 1 · Typo Detection | Misspelled identifiers, copy-paste errors, regex typos, off-by-ones |
| 2 · Security (OWASP Top 10) | SQLi, XSS, broken auth, hardcoded secrets, SSRF, command injection, and more |
| 3 · Typo → Vulnerability Chains | Traces how a typo can directly create or amplify a security issue |
| 4 · Production Readiness | Auth middleware order, null safety, async correctness, error handling |
| 5 · Code Quality | Dead code, naming, complexity, and positive observations |

Each review ends with a summary table and an **Overall Score / 10**.

The agent also **remembers** your review history and recurring anti-patterns across sessions, so you can ask things like *"What's my average score?"* or *"What patterns keep appearing in my code?"*

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| LLM | Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) via Workers AI |
| Coordination | Cloudflare Durable Objects — one DO instance per chat session |
| Memory / State | DO SQLite storage (review history, anti-patterns) + D1 database (session list) |
| User Interface | React 19 + Tailwind CSS v4, served as static assets |
| Real-time chat | WebSocket via the Cloudflare Agents SDK |
| Runtime | Cloudflare Workers |
| Build | Vite + `@cloudflare/vite-plugin` |

---

## Features

- 5-pass structured review with severity levels — Critical / High / Medium / Low
- Session sidebar — create, rename, and delete chat sessions persisted in D1
- Review history — tracks scores, languages, typo counts, and vulnerability counts
- Anti-pattern tracking — surfaces issues that keep recurring across all your reviews
- Message editing — edit a past message to re-run the review from that point
- Streaming responses with a stop button
- Dark / light mode toggle
- Starter prompts for quick testing

---

## Project structure

```
my-agent/
├── src/
│   ├── server.ts       # Cloudflare Worker + Durable Object (CodeReviewAgent)
│   ├── app.tsx         # React frontend — chat UI and session sidebar
│   ├── client.tsx      # React entry point
│   └── styles.css      # Tailwind CSS
├── wrangler.jsonc      # Cloudflare Workers configuration
├── vite.config.ts      # Vite build configuration
├── env.d.ts            # TypeScript bindings for the Workers environment
└── package.json
```

---

## How the architecture works

```
Browser
  │
  ├── GET /                      →  Static assets (React app)
  ├── GET /api/sessions          →  Worker  →  D1 (session list)
  └── WS  /agents/CodeReviewAgent/:sessionId
                │
                └── Durable Object (one per session)
                      ├── WebSocket handler
                      ├── SQLite storage (review history, anti-patterns)
                      └── Workers AI  →  Llama 3.3 70B (streaming)
```

Each chat session maps to its own Durable Object instance identified by a UUID. The DO holds the full message history and persists review statistics in SQLite. D1 stores only the session metadata (title, creation time) shown in the sidebar.

---

## Local development

### Prerequisites

- Node.js 18+
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/your-username/Cloudflare_Chatbot_Agent.git
cd my-agent

# 2. Install dependencies
npm install

# 3. Log in to Cloudflare
npx wrangler login

# 4. Create the D1 database (first time only)
npx wrangler d1 create code-review-sessions
# Copy the returned database_id into wrangler.jsonc under d1_databases

# 5. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Deploy

```bash
npm run deploy
```

This builds the React frontend and deploys the Worker, Durable Objects, and static assets in one step.

Your app will be live at:
```
https://my-agent.<your-subdomain>.workers.dev
```

---

## Wrangler configuration highlights

```jsonc
// wrangler.jsonc
{
  // Workers AI binding — no API key needed
  "ai": { "binding": "AI", "remote": true },

  // Route /agents/* and /api/* to the Worker first
  // (prevents the SPA fallback from intercepting API and WebSocket routes)
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/agents/*", "/api/*"]
  },

  // Durable Object — must use new_sqlite_classes for AIChatAgent
  "durable_objects": {
    "bindings": [{ "class_name": "CodeReviewAgentV2", "name": "CodeReviewAgent" }]
  },

  // D1 for session list
  "d1_databases": [{
    "binding": "DB",
    "database_name": "code-review-sessions",
    "database_id": "<your-database-id>"
  }]
}
```

> **Note on `run_worker_first`:** Without this, Cloudflare's SPA fallback serves `index.html` for `/api/*` routes instead of routing them to your Worker. Always add any API or WebSocket path prefixes here.

> **Note on `new_sqlite_classes`:** The `AIChatAgent` base class requires SQLite-backed Durable Objects. A class already deployed without SQLite cannot be converted — it must be created fresh under a new name.

---

## Example test cases

| Code | Expected result |
|------|----------------|
| SQL query built with string interpolation | Critical — SQL injection |
| `res.send(`Welcome ${req.body.username}`)` | Critical — reflected XSS |
| `jwt.encode({}, "secret", algorithm="none")` | Critical — unsigned JWT |
| `hashlib.md5(password)` | Critical — weak password hashing |
| bcrypt + parameterized queries + env secrets | Score 8–10, all practices praised |

---

## Known limitations

- Voice input is not supported — chat only
- No authentication — anyone with the URL can use the app
- Workers AI free tier rate limits apply under heavy usage

---

## License

MIT
