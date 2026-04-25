# Deployment Notes

- Store production secrets in `/opt/grouptrack/secrets/.env.prod`.
- Required values: `DATABASE_URL`, `SESSION_SIGNING_KEY`, `TLS_EMAIL`.
- Deploy: `./ops/scripts/deploy.sh <tag>`
- Rollback: `./ops/scripts/rollback.sh <tag>`
