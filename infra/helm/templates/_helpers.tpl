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
