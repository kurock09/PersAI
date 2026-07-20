{{- define "persai.workloadTopologySpreadConstraints" -}}
{{- $constraints := .constraints | default list -}}
{{- $labels := .labels | default dict -}}
{{- range $constraint := $constraints }}
- maxSkew: {{ $constraint.maxSkew }}
  topologyKey: {{ $constraint.topologyKey | quote }}
  whenUnsatisfiable: {{ $constraint.whenUnsatisfiable | quote }}
  labelSelector:
    matchLabels:
{{- range $key, $value := $labels }}
      {{ $key }}: {{ $value | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
ADR-152 requires migration -> API -> runtime. Runtime is admitted only after a
Sync hook proves the currently serving API /ready response advertises the
jobRef/status contract. Keep this exact-version gate narrow: a future contract
version requires an explicit ADR/chart update rather than silently weakening
the rollout prerequisite.
*/}}
{{- define "persai.adr152.assertAsyncJobRolloutContract" -}}
{{- if .Values.runtime.enabled -}}
{{- if not .Values.api.enabled -}}
{{- fail "ADR-152: runtime requires api.enabled so the async-job contract can be verified before rollout" -}}
{{- end -}}
{{- if not .Values.api.migrations.enabled -}}
{{- fail "ADR-152: runtime requires api.migrations.enabled so the additive async-job migration runs before API and runtime" -}}
{{- end -}}
{{- $apiVersion := .Values.api.asyncJobContract.version | default "" -}}
{{- $runtimeVersion := .Values.runtime.asyncJobContract.requiredVersion | default "" -}}
{{- if or (ne $apiVersion "v1") (ne $runtimeVersion "v1") -}}
{{- fail "ADR-152: api.asyncJobContract.version and runtime.asyncJobContract.requiredVersion must both be v1" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Exact sandbox-egress-proxy squid.conf body (byte-stable). Used both for the
ConfigMap data and the Deployment pod-template checksum annotation so ConfigMap
content changes force a Pod recreate despite subPath mounts.
*/}}
{{- define "persai.sandboxEgressProxy.squidConf" -}}
{{- $proxyPort := .Values.sandbox.egressProxy.port | int -}}
# PersAI sandbox egress proxy — ADR-126 S2: expanded allowlist + tool attribution.
# Exec pods route all HTTP(S) traffic here; Squid enforces the domain allowlist at L7
# by CONNECT authority / Host header (dstdomain). Only the domains listed below are
# reachable. Everything else is denied. No SSL bumping and no CA lifecycle — git push
# is intentionally allowed in v1 (matches Claude Code's posture; ADR-126 v2 D3
# follow-up 2026-06-23: founder confirmed push should be open).
#
# Logformat note (ADR-146 live repair): ubuntu/squid:6.6-24.04_edge runs Squid 6.14
# built with GnuTLS and without OpenSSL SSL-Bump, so %ssl::* tokens (including
# %ssl::>sni) are unsupported and crash the proxy at parse time. Destination audit
# uses %ru (CONNECT authority / request-URL). Static tool=shell is literal text.

http_port {{ $proxyPort }}

acl CONNECT method CONNECT

# Domain allowlist — add entries only with justification.
acl allowed_domains dstdomain{{- range .Values.sandbox.egressProxy.allowedDomains }} {{ . }}{{- end }}

# Permit CONNECT (HTTPS) and plain HTTP only to allowed domains.
http_access allow CONNECT allowed_domains
http_access allow allowed_domains
http_access deny all

# No on-disk cache; the proxy is a policy boundary, not a caching layer.
cache deny all

# Structured egress log: tool=shell is static v1 attribution (exec-pod outbound is
# exclusively shell-initiated through HTTP_PROXY env; richer per-tool attribution
# for control-plane operations — image_generate, document, files.* — lives in
# control-plane logs, not in this proxy log). Per ADR-126 v2 D12.
logformat persai_egress %ts.%03tu %>a %Ss/%03>Hs %<st %rm %ru tool=shell
access_log stdio:/dev/stdout persai_egress
cache_log stdio:/dev/stderr
pid_filename none
{{- end -}}

{{/*
ADR-146 Slice 2 — sandbox exec egress mode label + proxy-env Helm/pod-spec contract.
S3 owns runtime mode resolve and pod create/reuse. These helpers are selectable
builders only: defaultMode must stay restricted; full_public never becomes the
chart default path.
*/}}
{{- define "persai.sandboxExec.egressModeLabelKey" -}}
{{- .Values.networkPolicy.sandboxEgress.modeLabelKey | default "persai.io/sandbox-egress" -}}
{{- end -}}

{{- define "persai.sandboxExec.restrictedLabelValue" -}}
{{- .Values.networkPolicy.sandboxEgress.restrictedLabelValue | default "restricted" -}}
{{- end -}}

{{- define "persai.sandboxExec.fullPublicLabelValue" -}}
{{- .Values.networkPolicy.sandboxEgress.fullPublicLabelValue | default "full-public" -}}
{{- end -}}

{{- define "persai.sandboxExec.assertEgressContract" -}}
{{- $defaultMode := .Values.sandbox.execEgress.defaultMode | default "restricted" -}}
{{- if ne $defaultMode "restricted" }}
{{- fail "ADR-146: sandbox.execEgress.defaultMode must remain restricted; S3 selects full_public at runtime" }}
{{- end }}
{{- $labelKey := include "persai.sandboxExec.egressModeLabelKey" . -}}
{{- if ne $labelKey "persai.io/sandbox-egress" }}
{{- fail "ADR-146: networkPolicy.sandboxEgress.modeLabelKey must be persai.io/sandbox-egress" }}
{{- end }}
{{- $restricted := include "persai.sandboxExec.restrictedLabelValue" . -}}
{{- if ne $restricted "restricted" }}
{{- fail "ADR-146: networkPolicy.sandboxEgress.restrictedLabelValue must be restricted" }}
{{- end }}
{{- $fullPublic := include "persai.sandboxExec.fullPublicLabelValue" . -}}
{{- if ne $fullPublic "full-public" }}
{{- fail "ADR-146: networkPolicy.sandboxEgress.fullPublicLabelValue must be full-public" }}
{{- end }}
{{- if .Values.sandbox.execServiceAccount.gcpServiceAccountEmail }}
{{- fail "ADR-146: sandbox.execServiceAccount must not set gcpServiceAccountEmail (no Workload Identity / IAM on exec pods)" }}
{{- end }}
{{- end -}}

{{/*
Emit the exact ordered six-entry proxy env for restricted mode, or nothing for
full_public. Call as:
  include "persai.sandboxExec.proxyEnvForMode" (dict "root" . "mode" "restricted")
*/}}
{{- define "persai.sandboxExec.proxyEnvForMode" -}}
{{- $root := .root -}}
{{- $mode := .mode -}}
{{- if eq $mode "restricted" -}}
{{- $proxyUrl := $root.Values.sandbox.env.SANDBOX_EXEC_EGRESS_PROXY_URL | default "" -}}
{{- $noProxy := $root.Values.sandbox.env.SANDBOX_EXEC_NO_PROXY | default "" -}}
{{- if or (eq $proxyUrl "") (eq $noProxy "") }}
{{- fail "ADR-146: restricted proxy env requires sandbox.env.SANDBOX_EXEC_EGRESS_PROXY_URL and SANDBOX_EXEC_NO_PROXY" }}
{{- end }}
- name: HTTP_PROXY
  value: {{ $proxyUrl | quote }}
- name: HTTPS_PROXY
  value: {{ $proxyUrl | quote }}
- name: http_proxy
  value: {{ $proxyUrl | quote }}
- name: https_proxy
  value: {{ $proxyUrl | quote }}
- name: NO_PROXY
  value: {{ $noProxy | quote }}
- name: no_proxy
  value: {{ $noProxy | quote }}
{{- else if eq $mode "full_public" -}}
{{- /* intentionally empty: full_public pods must not receive proxy env */ -}}
{{- else -}}
{{- fail (printf "ADR-146: unknown sandbox egress mode %q" $mode) -}}
{{- end -}}
{{- end -}}

{{/*
Shared fail-closed validation for public-egress deny inventories used by the
restricted Squid proxy, NAT identity probe, and full-public exec policies.
*/}}
{{- define "persai.sandboxEgress.assertPublicDeniedInventory" -}}
{{- $requiredDenied := .Values.networkPolicy.sandboxEgress.requiredDeniedCidrs | default (list) -}}
{{- $publicDenied := .Values.networkPolicy.sandboxEgress.publicDeniedCidrs | default (list) -}}
{{- if eq (len $requiredDenied) 0 }}
{{- fail "networkPolicy.sandboxEgress.requiredDeniedCidrs must not be empty" }}
{{- end }}
{{- if eq (len $publicDenied) 0 }}
{{- fail "networkPolicy.sandboxEgress.publicDeniedCidrs must not be empty" }}
{{- end }}
{{- range $required := $requiredDenied }}
{{- if not (has $required $publicDenied) }}
{{- fail (printf "networkPolicy.sandboxEgress.publicDeniedCidrs is missing required CIDR %s" $required) }}
{{- end }}
{{- end }}
{{- end -}}
