# Manual Worker metadata audit

Purpose: query the existing `weekend-mwohae` deployment IDs/traffic percentages and Cron definitions without asking the user for repeated dashboard screenshots. This does not inspect CPU logs, D1 rows, ingestion results, script content or prove a deployed Git commit.

## Credential checkpoint — PAUSED_USER_ACTION

No credential has been created or registered by this change. No operational request has been made. Do not mark the connection verified until a real run succeeds.

After the workflow is reviewed and merged, the account owner can create a short-lived Cloudflare API token scoped to **only `weekend-mwohae`**, using **Individual Workers Metadata Read-Only**. Do not grant Editor/Admin, D1, billing, DNS or deployment access. The exact availability of this new per-Worker role in the user's token UI has not been verified. If unavailable or rejected, stop; do not silently widen permissions.

Store it using GitHub's repository Settings → Secrets and variables → Actions → New repository secret, named `CLOUDFLARE_OBSERVE_TOKEN`. Never send a token in chat, an issue, a commit, an artifact or a screenshot. This is a separate name; do not replace an existing deployment credential. Credential creation/registration requires the owner's action and authorization.

Workflow: `Worker metadata audit (manual)`. Run on `main` only, supplying the reviewed full 40-character main commit as `expected_sha`. Only the repository owner can trigger it, with no rerun, schedule, PR trigger or automatic retry. It makes two fixed GET requests, with 15-second request timeouts and a three-minute job limit. It installs no project dependencies, invokes no AI API, saves no raw responses, and prints only validated metadata. GitHub runner usage may apply under the repository's existing allowance; this change does not purchase or expand any budget.

403/missing secret: fail closed, retain `PAUSED_USER_ACTION`, do not retry automatically or broaden permissions. Empty deployment/schedule lists are reported as empty; never infer a healthy collector from successful HTTP responses.

## Evidence and limits

- Local synthetic fixtures verify fixed GET-only endpoints, credentials absent before network, no retry on 403, bounded response size, output validation, and suppression of upstream errors/unapproved fields.
- Git commit mapping remains `UNVERIFIED`; CPU and collection outcomes remain `NOT_CHECKED` regardless of metadata success.
- No production deploy, D1 operation, Cron mutation, manual collection, or recurring AI call is included.
- Next independent gate: obtain real official-detail execution evidence through an approved log access path. The historical-log query API currently documents `Workers Observability Write`; do not describe it as a read-only token or add it here.

Official references (checked 2026-10-16):

- https://developers.cloudflare.com/workers/authorization/workers/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/
- https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/schedules/methods/get/
- https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/
