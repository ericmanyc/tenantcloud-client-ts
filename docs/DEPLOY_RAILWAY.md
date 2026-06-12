# Hosting tc-mcp on Railway (for Claude on web)

The hosted server lets teammates use the TenantCloud connector from claude.ai
(web), with each person acting under **their own TenantCloud account**. It is a
multi-user server: OAuth 2.1 in front (claude.ai's custom-connector flow), an
encrypted per-user token vault in Postgres, and the same MCP tools as the
local stdio server.

## 1. Deploy

1. Create a Railway project from this GitHub repo. `railway.json` already sets
   the build (`npm install && npm run build`) and start
   (`node packages/mcp/dist/cli.js serve`) commands.
2. Add a **PostgreSQL** service to the project and attach its `DATABASE_URL`
   to the app service (Railway does this automatically when you reference it).
3. Set the app service variables:

   | Variable | Value |
   |----------|-------|
   | `BASE_URL` | the public URL Railway gives the service, e.g. `https://tc-mcp-production.up.railway.app` |
   | `TC_VAULT_KEY` | `openssl rand -hex 32` - encrypts the token vault. Losing it means everyone re-pairs. |
   | `TC_ADMIN_KEY` | `openssl rand -hex 32` - bearer key for the /admin endpoints (invites, revocation) |
   | `DATABASE_URL` | reference to the Postgres service |

4. Deploy. `GET /healthz` should return `{"ok":true}`.

## 2. Invite a teammate (admin)

```bash
TC_ADMIN_KEY=<your admin key> npx tc-mcp invite alice@yourco.com --server https://<your-app>.up.railway.app
```

This prints a one-time invite code and ready-to-send instructions. The invite
code is the teammate's credential for both the connector sign-in and pairing;
re-running `invite` for the same email rotates the code.

## 3. Teammate setup (once per person)

1. **Pair TenantCloud** (on their computer; they must be a sub-admin on your
   TenantCloud account):

   ```bash
   npx tc-mcp login --remote https://<your-app>.up.railway.app --email alice@yourco.com --code XXXX-XXXX
   ```

   This opens the normal TenantCloud browser sign-in (their password, their
   2FA) and uploads the resulting tokens to the server's encrypted vault. The
   server keeps them fresh from then on (daily keep-alive + refresh on use).

2. **Add the connector in claude.ai**: Settings -> Connectors -> Add custom
   connector -> URL `https://<your-app>.up.railway.app/mcp`. Claude opens the
   server's sign-in page: they enter their email + invite code once, and
   claude.ai stores the resulting OAuth tokens.

## 4. Offboarding

```bash
curl -X POST https://<your-app>.up.railway.app/admin/revoke \
  -H "Authorization: Bearer $TC_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"email":"alice@yourco.com"}'
```

This deletes their TenantCloud tokens from the vault and rotates their invite
code (so their connector sign-in stops working when their OAuth token expires).
Also remove their sub-admin in TenantCloud itself.

## Security model

- **Two layers**: the OAuth gate controls who can reach the MCP endpoint at
  all (email + invite code -> bearer tokens, stored hashed); the vault decides
  whose TenantCloud tokens each session uses. Sessions are bound to the user
  who authenticated - one teammate can never reach another's tokens.
- **Vault encryption**: token sets are AES-256-GCM encrypted with
  `TC_VAULT_KEY`, which lives only in Railway env vars - a leaked database
  dump alone is useless.
- **TenantCloud permissions still apply**: each teammate's tool calls run as
  their own TenantCloud sub-admin, so TenantCloud enforces their role and its
  audit log shows who did what.
- **Single instance**: run one replica. TenantCloud rotates refresh tokens on
  every refresh; the server serializes per-user token operations in-process,
  which is only safe with a single instance.
