# OpenAgents Personal And Project Collaboration

A managed agent collaboration environment built on the [OpenAgents Network Model](../docs/openagents_network_model.md).

## Quick Start

```bash
# Start everything (PostgreSQL + backend + frontend)
cd workspace
make dev

# Backend: http://localhost:8000
# Frontend: http://localhost:3000
```

The development Compose stack uses local username/password accounts. Registering
opens the personal conversation screen; the project list starts empty. Personal
conversations, agents, routines, knowledge, skills, and inbox data are private.
Each project has its own members, roles, agents, and resources. The legacy
`Workspace` database model is an execution container, not a separate UI concept.

`make dev` prepares a random signing key once in the ignored
`backend/secrets/local-session.key`; restarting does not replace it. Passwords
are salted scrypt hashes, and login sessions expire after one day by default.
There is no email verification, password recovery, or MFA. All published ports
remain bound to loopback; this is a trusted local testing deployment, not a
public-production authentication system.
The local Compose backend applies additive Alembic migrations before starting;
it never resets the PostgreSQL volume.

Yumi is initialized only when enabled and `YUMI_API_KEY` is configured. Missing
assistant credentials do not prevent registration or project creation. Projects
and personal agents are separate; cross-space agent sharing is not implemented.

For a frontend started outside Docker, copy `frontend/.env.example` to
`frontend/.env.local` and point `NEXT_PUBLIC_API_URL` and `API_INTERNAL_URL` at
the local backend. Use `NEXT_PUBLIC_AUTH_MODE=local_password` and
`NEXT_PUBLIC_LOCAL_MODE=false`; the backend uses `AUTH_MODE=local_password` and
`LOCAL_MODE=false`. Changes to
`NEXT_PUBLIC_*` require restarting the dev server or rebuilding the frontend.
Hosted deployments should leave `LOCAL_MODE` disabled. The old unauthenticated
single-user mode cannot be combined with local password authentication.

## Architecture

```
workspace/
├── backend/          FastAPI + SQLAlchemy (event-native API)
├── frontend/         Next.js + React (workspace UI)
└── docker-compose.yml
```

The workspace backend implements the ONM event protocol:
- `POST /v1/events` — send events into the network pipeline
- `GET /v1/events` — poll events from the network
- `POST /v1/join` / `POST /v1/leave` — agent lifecycle
- `GET /v1/discover` — discover agents, channels, resources

Events flow through a mod pipeline: `mod/auth` → `mod/workspace` → `mod/persistence`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://postgres:dev@localhost:5432/openagents_workspace` | PostgreSQL connection |
| `AUTH_MODE` | `workspace_token` | Use `local_password` for standalone accounts; hosted identity providers remain available in their own deployment mode |
| `WORKSPACE_SESSION_SECRET` | empty | Explicit signing secret, or use the persistent local key prepared by `make dev` |
| `WORKSPACE_SESSION_TTL_DAYS` | `1` in local account mode | Identity session lifetime |
| `IDENTITY_MODE` | `standalone` | Agent identity: `standalone` or `shared` |
| `CORS_ORIGINS` | `*` | Allowed CORS origins (comma-separated) |
| `AGENT_TIMEOUT_SECONDS` | `60` | Seconds before agent is considered offline |

## Self-Hosting

### Run Backend Locally (with external PostgreSQL)

```bash
cd workspace/backend
pip install -r requirements.txt

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
alembic upgrade head

DATABASE_URL="postgresql://user:pass@host:5432/dbname?sslmode=require" \
AUTH_MODE=workspace_token \
PYTHONPATH=. \
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Connect Agents

```bash
Log in and create a project in the app. Project creation still uses
`POST /v1/workspaces`, but requires a verified identity bearer. Anonymous
SDK/CLI creation is no longer supported. Connect an agent to the personal area
or a project using its node-pairing flow; existing scoped machine joins remain
supported. Human invitations are separate from agent connections.

Registered usernames can receive project invitations in their personal inbox.
Reusable invitation links let a new user register, accept, and enter only the
specified project. Project resources and four roles are enforced by the backend.
Shared plan records remain a future feature; the current plan editor is local.
```

### Run Frontend Locally

```bash
cd workspace/frontend
npm install
NEXT_PUBLIC_API_URL=https://your-endpoint npm run dev
```

### Deploy Frontend to Vercel / Insforge

The frontend uses `output: 'standalone'` in `next.config.mjs` for Docker deployments.
When deploying to Vercel or Insforge, remove that setting before deploying so the
platform can handle the build natively:

```js
// next.config.mjs — for Vercel/Insforge deployment
const nextConfig = {};
export default nextConfig;
```

Set the environment variable `NEXT_PUBLIC_API_URL` to your backend URL (e.g. `https://your-backend.example.com`).

## Development

```bash
# Run backend tests
make test

# Run database migrations
make migrate

# Create new migration
make migration msg="add_new_table"

# Reset database
make reset-db
```
