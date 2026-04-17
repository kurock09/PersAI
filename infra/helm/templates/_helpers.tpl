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
