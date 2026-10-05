param()
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($taskManifest.id -ne 'weread-pocket' -or $taskManifest.version -notmatch '^\d+\.\d+\.\d+$') {
  throw 'Unexpected plugin ID or version.'
}

& node (Join-Path $taskRoot 'scripts/build.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
& node (Join-Path $taskRoot 'scripts/check.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Local checks failed.' }

$taskOutput = [System.IO.Path]::GetFullPath((Join-Path $taskRoot ('dist/' + $taskManifest.version)))
$taskInstallFolder = [System.IO.Path]::GetFullPath((Join-Path $taskOutput $taskManifest.id))
$taskZip = [System.IO.Path]::GetFullPath((Join-Path $taskOutput ($taskManifest.id + '-' + $taskManifest.version + '.zip')))
foreach ($taskPath in @($taskOutput, $taskInstallFolder, $taskZip)) {
  if (-not $taskPath.StartsWith($taskRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package output must remain inside this project.'
  }
}
New-Item -ItemType Directory -Path $taskOutput, $taskInstallFolder -Force | Out-Null
$taskWhitelist = @('main.js','manifest.json','styles.css','LICENSE')
foreach ($taskName in $taskWhitelist) {
  $taskSource = Join-Path $taskRoot $taskName
  Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskOutput $taskName) -Force
  Copy-Item -LiteralPath $taskSource -Destination (Join-Path $taskInstallFolder $taskName) -Force
}
$taskUnexpected = @(Get-ChildItem -LiteralPath $taskInstallFolder -Force | Where-Object { $_.PSIsContainer -or $_.Name -notin $taskWhitelist })
if ($taskUnexpected.Count) { throw 'Unexpected files in the installation archive folder; no archive was created.' }
Compress-Archive -LiteralPath $taskInstallFolder -DestinationPath $taskZip -Force
$taskChecksums = foreach ($taskName in @($taskWhitelist) + @([System.IO.Path]::GetFileName($taskZip))) {
  $taskAsset = Join-Path $taskOutput $taskName
  (Get-FileHash -LiteralPath $taskAsset -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $taskName
}
[System.IO.File]::WriteAllText((Join-Path $taskOutput 'SHA256SUMS.txt'), ($taskChecksums -join "`n") + "`n", (New-Object System.Text.UTF8Encoding($false)))
Write-Output ('Prepared local release files: ' + $taskOutput)
Write-Output 'No vault installation, Git push, or publication was performed.'
