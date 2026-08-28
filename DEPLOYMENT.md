# Backend Deployment

This directory is the backend source of truth.

- Git remote: `https://github.com/Nee200/note-backend.git`
- Hosting: Render
- Runtime entrypoint: `node server.js`
- Health endpoint: `/health`
- Readiness endpoint: `/ready`
- Scheduled uptime check: `.github/workflows/health-monitor.yml`

Operational notes:

- Production secrets must be configured in Render environment variables, not in Git.
- Invoice generation and the AdminPortal invoice tab are enabled by default. Set `INVOICES_ENABLED=false` in Render and restart/deploy the service to hide and pause them; existing invoice records stay preserved while disabled.
- Local `.env`, `.env.localtest`, JSON data dumps, logs, cookie jars, and `tmp_*` request files are intentionally ignored.
- The frontend is deployed separately from `note-frontend.git` to Netlify.
