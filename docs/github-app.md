# GitHub App Integration

Environment variables:

- `GITHUB_APP_ID`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_WEBHOOK_SECRET`

Implemented local contract:

- GitHub repository parsing and clone planning avoid token-in-argv leaks.
- Webhook signatures are verified with HMAC SHA-256.
- GitHub integration tokens are stored as encrypted `SecretValue` rows or sealed in the local store.
- PR preview deployment is exercised by `pnpm dev:e2e` with a pull request fixture payload.

Without real GitHub credentials, use manual repo import or webhook fixtures. With credentials, the same API contract maps to GitHub OAuth/App installation and webhook endpoints in `openapi/raibitserver.yaml`.
