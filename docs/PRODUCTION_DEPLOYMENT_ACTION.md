# Manual production Worker deployment

This owner-only GitHub Actions workflow reuses the existing `npm run deploy:verified` guard. It is manual; merging code to `main` does not deploy automatically.

## One-time credential setup

Create a Cloudflare account API token and save it in the repository as the Actions secret `CLOUDFLARE_DEPLOY_TOKEN`. Scope its permissions to only these existing resources:

- Worker `weekend-mwohae`: **Editor** (or the equivalent individual Worker Editor role), required to list the configured Worker secrets and deploy its code.
- D1 database `weekend-mwohae-production`: **Read** only, required for the verified deploy script's fixed bounded read-only schema preflight.

Do not grant D1 write access, account-wide Worker Editor, Worker creation, route editing, or unrelated product access. Do not put the token in repository files, workflow inputs, logs, or chat. GitHub stores the secret value; the workflow only checks that it is present and never prints it.

## Run

After the change is merged and required CI passes, open **Actions → Production Worker deploy (manual) → Run workflow**. Select `main` and enter the exact reviewed 40-character main commit SHA in `expected_sha`.

The workflow rejects non-owner/manual runs, non-main refs, mismatched SHAs, and reruns. It runs only `npm run deploy:verified`, which selects the explicit platform-home preflight, checks existing Cloudflare secrets, verifies the existing read-only D1 schema, builds, and deploys the configured existing Worker. It does not run ingestion or D1 migrations.

## Platform-home preflight (legacy collector retired)

The platform-home mode requires the existing production Worker and D1 binding, production assets, and an explicitly empty Cron array. It preserves the existing secret checks and validates a bounded fixed SELECT against the existing events and sources tables, even if those tables have no recent event rows. Failed commands, malformed responses, and unexpected configuration stop deployment. It performs no ingestion, D1 migration, or D1 write. Existing event routes, data, secrets, and bindings are retained. The former event-service mode still requires fresh TourAPI data; do not restart retired collection to satisfy that obsolete requirement.

After deployment, open `https://galteum.com/`, verify the platform home, one live wholesale link to `https://wholesale.galteum.com/wholesale/`, and a non-clickable detail-page card. Verify unauthenticated wholesale access still redirects to Cloudflare Access. Check the Worker Cron list remains empty. Do not expand token scope if deployment fails.
