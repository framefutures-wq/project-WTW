# Manual production Worker deployment

This owner-only GitHub Actions workflow reuses the existing `npm run deploy:verified` guard. It is manual; merging code to `main` does not deploy automatically.

## One-time credential setup

Create a Cloudflare account API token and save it in the repository as the Actions secret `CLOUDFLARE_DEPLOY_TOKEN`. Scope its permissions to only these existing resources:

- Worker `weekend-mwohae`: **Editor** (or the equivalent individual Worker Editor role), required to list the configured Worker secrets and deploy its code.
- D1 database `weekend-mwohae-production`: **Read** only, required for the verified deploy script's fixed `SELECT count(*)` preflight.

Do not grant D1 write access, account-wide Worker Editor, Worker creation, route editing, or unrelated product access. Do not put the token in repository files, workflow inputs, logs, or chat. GitHub stores the secret value; the workflow only checks that it is present and never prints it.

## Run

After the change is merged and required CI passes, open **Actions → Production Worker deploy (manual) → Run workflow**. Select `main` and enter the exact reviewed 40-character main commit SHA in `expected_sha`.

The workflow rejects non-owner/manual runs, non-main refs, mismatched SHAs, and reruns. It runs only `npm run deploy:verified`, which checks the existing Cloudflare secrets and recent real TourAPI data, builds, and deploys the configured existing Worker. It does not run ingestion or D1 migrations.

The current deploy guard's remote query is read-only. If it returns no recent real TourAPI row, the workflow stops before build/deployment; do not bypass that guard.
