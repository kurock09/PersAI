param(
    [string]$Namespace = "persai-dev",
    [string]$Service,
    [int]$LocalPort,
    [int]$RemotePort
)

while ($true) {
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Starting port-forward $Service $LocalPort`:$RemotePort ..."
    $proc = Start-Process -NoNewWindow -PassThru -FilePath "kubectl" `
        -ArgumentList "-n", $Namespace, "port-forward", "svc/$Service", "${LocalPort}:${RemotePort}"
    $proc.WaitForExit()
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Port-forward $Service died (exit $($proc.ExitCode)). Restarting in 2s..."
    Start-Sleep -Seconds 2
}
