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
- Local `.env`, `.env.localtest`, JSON data dumps, logs, cookie jars, and `tmp_*` request files are intentionally ignored.
- The frontend is deployed separately from `note-frontend.git` to Netlify.
