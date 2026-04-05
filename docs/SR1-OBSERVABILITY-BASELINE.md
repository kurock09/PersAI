# SR1 OBSERVABILITY BASELINE

## Status
Operational baseline for closing `SR1`.

## Purpose
Define the minimum deploy-observation, alert, and operator runbook layer that must exist before the program moves from `SR1` to `SR2`.

This baseline is intentionally narrow:

- API probes and Prometheus-style metrics from PersAI API
- existing OpenClaw probe and log signals only
- no tracing platform
- no queue/runtime redesign
- no new infra topology assumptions

## Current Signal Truth
### PersAI API
Available and required:

- `GET /health`
- `GET /ready`
- `GET /metrics`
- readiness dependency gauges:
  - `app_ready`
  - `app_dependency_ready{dependency=...}`
  - `app_dependency_check_duration_ms{dependency=...}`
- request metrics:
  - `http_requests_total`
  - `http_requests_in_flight`
  - `http_error_requests_total`
  - `http_requests_by_status_total{method,route,status_code,status_class}`
  - `http_request_duration_ms_bucket`
  - `http_request_duration_ms_sum`
  - `http_request_duration_ms_count`
- process memory gauges:
  - `process_resident_memory_bytes`
  - `nodejs_heap_used_bytes`
  - `nodejs_heap_total_bytes`
  - `nodejs_external_memory_bytes`

### OpenClaw
Available and required:

- `GET /healthz`
- `GET /readyz`
- local/authenticated readiness detail on `/ready` or `/readyz`:
  - `ready`
  - `failing[]`
  - `uptimeMs`
- startup/backoff readiness logs from `waitForTransportReady()`:
  - `<transport> not ready after <ms> (<reason>)`
- PersAI Telegram runtime error logs when Telegram is active:
  - `[persai-telegram] ... failed`
  - `[persai-telegram] ... error`
- PersAI API `runtime_route` log lines proving which OpenClaw pool actually handled real runtime traffic

Not yet available in `SR1`:

- OpenClaw Prometheus metrics endpoint
- queue depth / worker throughput metrics
- multi-replica correctness proof
- distributed tracing

## Deploy Observation Checklist
Use this checklist for the `Tier 2` and `Tier 3` observation window after any deploy that changes API readiness/metrics wiring or OpenClaw runtime config relevant to probes.

### Tier 2 smoke
1. Confirm PersAI API `GET /health` returns `200`.
2. Confirm PersAI API `GET /ready` returns `200` in the healthy baseline.
3. Confirm PersAI API `GET /metrics` exposes:
   - `app_ready`
   - `app_dependency_ready{dependency="identity_access_db"}`
   - `app_dependency_ready{dependency="workspace_management_db"}`
   - `http_requests_total`
   - `http_error_requests_total`
   - `http_request_duration_ms_bucket`
4. Confirm OpenClaw `GET /healthz` returns `200`.
5. Confirm OpenClaw `GET /readyz` returns `200` for the active pool.
6. Trigger one real runtime path and confirm a matching PersAI API `runtime_route` log line appears for the expected pool.

### Tier 3 observation window
During the first bounded observation window after deploy, verify:

- `app_ready` stays `1`
- both API dependency gauges stay `1`
- `increase(http_error_requests_total[5m])` stays at the expected baseline
- active routes show non-pathological latency via:
  - `http_request_duration_ms_bucket`
  - `http_request_duration_ms_sum`
  - `http_request_duration_ms_count`
- OpenClaw `healthz` and `readyz` stay green for the active pool
- no repeated OpenClaw transport startup warnings
- no repeated `[persai-telegram]` failure/error lines when Telegram is active

## Minimum Alert Baseline
### Required API alerts
- `app_ready == 0`
- `app_dependency_ready{dependency="identity_access_db"} == 0`
- `app_dependency_ready{dependency="workspace_management_db"} == 0`
- sustained `increase(http_error_requests_total[5m]) > 0`
- sustained high latency on active routes from the latency histogram family
- sustained abnormal process memory growth from resident/heap gauges

### Required OpenClaw alerts
- active pool `readyz != 200`
- repeated transport-not-ready log lines during startup/recovery
- repeated `[persai-telegram]` failure/error logs when Telegram is enabled

## Operator Notes
### API `/ready`
- `/ready` is the operational truth for API process + DB dependency readiness.
- It does not prove OpenClaw multi-replica safety.
- Public dependency errors are intentionally sanitized.

### OpenClaw `/readyz`
- `/readyz` is the operational truth for current gateway/channel readiness.
- Detailed `failing[]` is intentionally restricted to local or authenticated callers.
- A green `readyz` does not prove multi-replica correctness or queue capacity.

### Runtime route proof
- For any real traffic-path validation, do not infer pool selection from config alone.
- Use the PersAI API `runtime_route` log line as the proof of which OpenClaw host/tier actually served the request.

## SR1 Closure Statement
`SR1` is considered closeable when:

- the PersAI API readiness and request-metrics baseline is present
- the OpenClaw probe/log baseline above is documented and used operationally
- deploy smoke and observation-window expectations are explicit
- the remaining known gaps are deferred to later slices instead of silently ignored

After this baseline, the next slice is `SR2`.
