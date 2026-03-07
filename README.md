# FileAnalyzer

Docker-ready Web UI for analyzing and cleaning up directory structures on NAS / Debian systems.

![Python](https://img.shields.io/badge/Python-3.10-blue) ![React](https://img.shields.io/badge/React-Vite-purple) ![Docker](https://img.shields.io/badge/Docker-Ready-green)

## Features

- 🔍 **Directory Analysis** — Detect empty dirs, garbage files, BT junk, metadata-only folders, missing videos
- 🗂️ **Visual Browser** — Click-through folder navigation with per-directory scan & analyze
- 🌲 **Tree View** — Interactive collapsible directory tree with search filter
- ✏️ **Batch Rename** — Regex-based preview → execute rename workflow
- 🗑️ **Batch Delete** — Regex or path-based preview → execute delete workflow
- 📥 **Export** — Download analysis results as CSV or JSON
- ⚡ **Fast Scanning** — Native `tree` command for high-performance directory parsing

## Quick Start

```bash
docker-compose up -d --build
# Open http://localhost:5000
```

## docker-compose.yml

```yaml
services:
  fileanalyzer:
    build: .
    ports:
      - "5000:5000"
    volumes:
      - /your/data/path:/data
      # Mount multiple directories:
      # - /mnt/nas/media:/data/media:ro
      # - /mnt/nas/downloads:/data/downloads:ro
    environment:
      - DATA_DIR=/data
    restart: unless-stopped
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.10, Flask, Gunicorn |
| Frontend | React, Vite, Lucide Icons |
| Deploy | Docker multi-stage build |
| Scanning | Native `tree --du -h` |

## License

MIT
