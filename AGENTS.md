## Cursor Cloud specific instructions

### Project overview

FileAnalyzer is a two-layer web app (React + Flask) for analyzing and cleaning directory structures. No database or external services required — it is entirely filesystem-based.

### Services

| Service | Command | Port |
|---------|---------|------|
| Backend (Flask) | `cd backend && DATA_DIR=/workspace/data TREE_DIR=/workspace/data/.fileanalyzer python3 app.py` | 5000 |
| Frontend (Vite) | `cd frontend && npm run dev` | 5173 |

The Flask dev server serves the built frontend SPA from `backend/dist/`. During development, run both Vite (for hot-reload) and Flask (for API).

### System dependency

The `tree` CLI tool must be installed (`sudo apt-get install -y tree`). The backend uses `tree --du -h` for directory scanning.

### Build

- Frontend build: `cd frontend && npm run build` — outputs to `backend/dist/`

### Lint / Test

No ESLint, pytest, or other lint/test tooling is configured in this repo. There are no automated tests or linting scripts. If adding lint or tests, configure them from scratch.

### Data directory

The app needs a writable data directory. Set `DATA_DIR` env var (defaults to `./data` relative to project root). A `.fileanalyzer` subdirectory is auto-created for scan cache files.

### Gotchas

- Python packages install to `~/.local/bin` (user install) — ensure `$HOME/.local/bin` is on `PATH`.
- The Vite dev server does not proxy API calls to Flask by default; use the Flask server on port 5000 for the full integrated app.
