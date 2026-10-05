param(
  [string]$ObsidianCli = 'obsidian',
  [string]$Vault = ''
)

# Keep the CLI payload short. The browser audit uses only an isolated iframe.
$taskProjectRoot = (Split-Path -Parent $PSScriptRoot).Replace('\', '/').Replace("'", "\'")
$taskAuditPath = (Join-Path $PSScriptRoot 'card-geometry-browser.js').Replace('\', '/').Replace("'", "\'")
$taskEntry = "eval(require('fs').readFileSync('$taskAuditPath','utf8'))('$taskProjectRoot')"
$taskArguments = @('eval', "code=$taskEntry")
if($Vault) { $taskArguments = @("vault=$Vault") + $taskArguments }
& $ObsidianCli @taskArguments
