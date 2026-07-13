# ADR-146 S6 operator fixture contract

`../adr146-s6-live-acceptance.mjs` is acceptance preparation, not an owned
public test service. It deliberately has no default Internet endpoints.
Before `--execute`, the operator must define endpoints they own and are
authorized to probe:

- SSH endpoint returning an `SSH-` banner within 8 seconds.
- TCP and UDP echo endpoints that return the exact generated nonce within 8
  seconds. Ports must be custom non-HTTP ports.
- HTTP(S) redirect endpoint whose first response has an absolute `Location`
  with the exact `--redirect-target-host`. At acceptance time that target must
  be private/special-use and the follow must time out.
- DNS rebinding fixture put into its private-answer phase before execution.
  Every IPv4 answer for `--private-dns-host` must be private/special-use,
  include `--private-dns-ip`, and connection to `--private-dns-port` must time
  out or be network/host unreachable. A refusal is a failure because it proves
  destination reachability.
- Restricted allow/deny URLs with no credentials, query, or fragment. The
  allow URL must succeed through the configured proxy; the deny HTTPS URL must
  return CONNECT 403; removing all proxy variables must time out.
- A running canonical `full-public` exec pod and a running `restricted` exec
  pod belonging to a different assistant. The helper checks both before and
  after probes; this is the unaffected-second-assistant control.

Public fixture hosts and URLs are mandatory operator inputs. Do not use
documentation-only domains, random third-party hosts, or production services
without owner approval.

## Browser, web-search, and cleanup command specs

Copy each `*.example.json`, replace the executable/arguments, and keep the file
inside the repository. Commands run directly without a shell, inherit the
operator process environment, have a 1–300 second deadline, and must emit only
the exact configured sentinel plus a newline. Put credentials in an approved
process environment or credential helper, never in JSON or command arguments.

Browser and web-search commands must exercise the normal PersAI acceptance
path against the same deployed release and emit their sentinel only after
asserting unchanged behavior. The cleanup command must idempotently remove
only the operator-owned SSH/TCP/UDP/redirect/DNS fixtures for this run and emit
its sentinel only after confirming absence. It is mandatory and runs after
success or failure. If cleanup fails, the helper exits nonzero (and preserves
both failures when a probe also failed).

All probe operations are bounded to 5–10 seconds; external smoke/cleanup
commands are bounded by their spec. The helper creates no fixture or cluster
resource itself.

Validate inputs without network activity:

```bash
node infra/bootstrap/adr146-s6-live-acceptance.mjs \
  --full-public-pod "$FULL_PUBLIC_POD" \
  --restricted-pod "$SECOND_RESTRICTED_POD" \
  --ssh-host "$OWNED_SSH_HOST" --ssh-port "$OWNED_SSH_PORT" \
  --tcp-host "$OWNED_TCP_ECHO_HOST" --tcp-port "$OWNED_TCP_ECHO_PORT" \
  --udp-host "$OWNED_UDP_ECHO_HOST" --udp-port "$OWNED_UDP_ECHO_PORT" \
  --restricted-allow-url "$RESTRICTED_ALLOW_URL" \
  --restricted-deny-url "$RESTRICTED_DENY_URL" \
  --redirect-url "$OWNED_REDIRECT_URL" \
  --redirect-target-host "$DENIED_REDIRECT_TARGET_HOST" \
  --private-dns-host "$OWNED_REBIND_HOST" \
  --private-dns-ip "$EXPECTED_PRIVATE_IPV4" \
  --private-dns-port "$DENIED_PRIVATE_PORT" \
  --browser-smoke-spec infra/bootstrap/adr146-s6-fixtures/browser-smoke.example.json \
  --web-search-smoke-spec infra/bootstrap/adr146-s6-fixtures/web-search-smoke.example.json \
  --cleanup-spec infra/bootstrap/adr146-s6-fixtures/cleanup.example.json
```

Replace all example commands and run the dry-run **before provisioning**. The
dry-run is shape validation only, so endpoints need not be live. After it
passes, provision the exact reviewed fixtures, append `--execute` to the same
validated command, and do not change inputs between validation and execution.
Once live probe execution starts, cleanup runs in `finally` on success or
failure. If provisioning fails or the helper cannot enter execution because
local input/spec validation now fails, invoke the reviewed cleanup spec
directly; no probe command ran in that path.

Record stdout, stderr, exit status, UTC start/end, release SHA, pod UIDs, fixture
ownership/ticket, and cleanup evidence. A nonzero exit or missing PASS line is
not acceptance.
