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
