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
