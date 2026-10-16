# Manual Worker metadata audit

Purpose: query the existing `weekend-mwohae` deployment IDs/traffic percentages and Cron definitions without asking the user for repeated dashboard screenshots. This does not inspect CPU logs, D1 rows, ingestion results, script content or prove a deployed Git commit.

## Credential checkpoint — VERIFIED for metadata on 2026-10-17

Owner completed account-owned token registration. Manual metadata run `38937281342` succeeded in 16 seconds on `d687798`, with the selected per-Worker Metadata Read-Only permission. It returned version `5738282d-70ec-45c9-bb73-829b2b1834e2` and the expected three Cron definitions. This verifies metadata access only.

After the workflow is reviewed and merged, the account owner can create a short-lived Cloudflare API token scoped to **only `weekend-mwohae`**, using **Individual Workers Metadata Read-Only**. Do not grant Editor/Admin, D1, billing, DNS or deployment access. The owner verified this scope in Manage Account → Account API Tokens, using Start from scratch → Specified Workers → weekend-mwohae → Metadata Read-only, with seven-day expiration. The My Profile user-token screen is not the correct setup path. Do not silently widen permissions.

Store it using GitHub's repository Settings → Secrets and variables → Actions → New repository secret, named `CLOUDFLARE_OBSERVE_TOKEN`. Never send a token in chat, an issue, a commit, an artifact or a screenshot. This is a separate name; do not replace an existing deployment credential. Credential creation/registration requires the owner's action and authorization.

Workflow: `Worker metadata audit (manual)`. Run on `main` only, supplying the reviewed full 40-character main commit as `expected_sha`. Only the repository owner can trigger it, with no rerun, schedule, PR trigger or automatic retry. It makes two fixed GET requests, with 15-second request timeouts and a seven-minute job limit. With the default metadata-only mode, it installs no project dependencies, invokes no AI API, saves no raw responses, and prints only validated metadata. GitHub runner usage may apply under the repository's existing allowance; this change does not purchase or expand any budget.

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

## Optional bounded live observation

`observe_live` defaults to false. When explicitly enabled by the owner on a reviewed main SHA, the workflow first completes metadata reads, then installs the existing lockfile with scripts disabled before exposing the observation token to the final step. `worker-live-audit.mjs` uses the existing locked Wrangler CLI (`tail --format json`) and runner jq. No new Worker or persistent logging destination is deployed. Wrangler opens a temporary observation session and is signaled to clean it up after 180 seconds, with a five-second kill fallback. Successful teardown is not inferred after a forced kill.

Raw streams are never forwarded or saved as artifacts. CLI disk logging and metrics are disabled. Output retains scheduled invocation outcomes, numeric timestamps/timing (missing fields remain null), known Cron strings and fixed Dispatcher stages only; request headers, URLs, freeform messages, exception details and token values are discarded. The raw stream has a 1 MiB cap; output keeps at most 20 invocations / 40 stages each. Diagnostics, filter errors, early exit and overflow stop observation; the wrapper never retries or broadens access.

A completed window with no scheduled event fails verification. Any observed non-ok outcome also fails, with sanitized evidence retained. A clean short sample does not prove long-term CPU recovery or database/publication progress. If the official lane is absent, report NOT OBSERVED rather than fixed. Exact CPU values are unavailable when the live event lacks timing fields. Real-time logs may be sampled by Cloudflare even with no client sampling filter.

- https://developers.cloudflare.com/workers/observability/logs/real-time-logs/
- https://developers.cloudflare.com/workers/wrangler/commands/workers/

Local installed-CLI validation reproduced the initial startup failure: Wrangler 4.135.0 rejects an explicit `--sampling-rate 1` before any tail request. The observation command now omits that optional filter. Runs `38939055921` and `38940201655` ended before scheduled events; neither verified collector execution or CPU behavior.
