{{- define "persai.openclaw.poolFullName" -}}
{{- printf "openclaw-%s" .poolKey | replace "_" "-" -}}
{{- end -}}

{{- define "persai.openclaw.poolConfigMapName" -}}
{{- printf "%s-config" (include "persai.openclaw.poolFullName" .) -}}
{{- end -}}

{{- define "persai.openclaw.poolMergedValues" -}}
{{- $rootOpenclaw := omit .Values.openclaw "runtimePools" -}}
{{- $poolConfig := .pool.config | default dict -}}
{{- toYaml (mergeOverwrite (deepCopy $rootOpenclaw) $poolConfig) -}}
{{- end -}}

{{- define "persai.openclaw.assertSupportedRuntimePool" -}}
{{- $poolKey := .poolKey -}}
{{- $openclaw := .openclaw -}}
{{- $readinessMode := (default "single_replica" (get ($openclaw.env | default dict) "PERSAI_RUNTIME_READINESS_MODE") | toString | trim | lower) -}}
{{- if ne $readinessMode "single_replica" -}}
{{- fail (printf "OpenClaw runtime pool %q declares unsupported PERSAI runtime mode %q. Supported PersAI contract remains single_replica with one pod per runtime pool." $poolKey $readinessMode) -}}
{{- end -}}
{{- $replicas := int (default 1 $openclaw.replicaCount) -}}
{{- if ne $replicas 1 -}}
{{- fail (printf "OpenClaw runtime pool %q sets replicaCount=%d, but PersAI-supported OpenClaw runtime remains single-replica with one pod per runtime pool." $poolKey $replicas) -}}
{{- end -}}
{{- if ($openclaw.autoscaling.enabled | default false) -}}
{{- fail (printf "OpenClaw runtime pool %q enables autoscaling, but PersAI-supported OpenClaw runtime remains single-replica with one pod per runtime pool." $poolKey) -}}
{{- end -}}
{{- end -}}

{{- define "persai.openclaw.renderSupportedRuntimePoolStrategy" -}}
{{- $poolKey := .poolKey -}}
{{- $strategy := .strategy | default dict -}}
{{- $strategyType := (default "Recreate" (get $strategy "type") | toString | trim) -}}
{{- if ne (lower $strategyType) "recreate" -}}
{{- fail (printf "OpenClaw runtime pool %q declares unsupported deployment strategy type %q. Supported PersAI contract requires Recreate to avoid overlapping pods during rollout." $poolKey $strategyType) -}}
{{- end -}}
{{- if hasKey $strategy "rollingUpdate" -}}
{{- fail (printf "OpenClaw runtime pool %q declares rollingUpdate settings, but supported PersAI contract requires Recreate to avoid overlapping pods during rollout." $poolKey) -}}
{{- end -}}
type: Recreate
{{- end -}}

{{- define "persai.openclaw.imageRef" -}}
{{- $values := .Values -}}
{{- $image := .image -}}
{{- $tag := default $values.global.images.tag $image.tag -}}
{{- $digest := default "" $image.digest -}}
{{- $repository := printf "%s/%s/%s/%s" $values.global.images.registryHost $values.global.images.projectId $values.global.images.repository $image.name -}}
{{- if ne $digest "" -}}
{{- printf "%s@%s" $repository $digest -}}
{{- else -}}
{{- printf "%s:%s" $repository $tag -}}
{{- end -}}
{{- end -}}

{{- define "persai.openclaw.sandboxCommonImageRef" -}}
{{- $values := .Values -}}
{{- $openclaw := .openclaw -}}
{{- $sandboxImages := $openclaw.sandboxImages | default dict -}}
{{- $common := $sandboxImages.common | default dict -}}
{{- $image := dict "name" (default "openclaw-sandbox-common" $common.name) "tag" (default $openclaw.image.tag $common.tag) "digest" (default "" $common.digest) -}}
{{- include "persai.openclaw.imageRef" (dict "Values" $values "image" $image) -}}
{{- end -}}

{{- define "persai.openclaw.shellQuote" -}}
{{- $value := toString . -}}
'{{- replace "'" "'\"'\"'" $value -}}'
{{- end -}}

{{- define "persai.openclaw.shellJoin" -}}
{{- $parts := list -}}
{{- range . -}}
{{- $parts = append $parts (include "persai.openclaw.shellQuote" .) -}}
{{- end -}}
{{- join " " $parts -}}
{{- end -}}

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
