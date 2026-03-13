param()

$ErrorActionPreference = "Stop"

# 디버그 로그: 훅 호출 여부 + 각 분기점 추적
$debugLog = Join-Path $PSScriptRoot "hook-debug.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -Path $debugLog -Value "[$timestamp] Hook triggered"

if ($env:FEEDBACK_LOOP_ACTIVE -eq "1") {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: FEEDBACK_LOOP_ACTIVE=1"
  exit 0
}

$inputJson = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($inputJson)) {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: empty stdin"
  exit 0
}

try {
  $payload = $inputJson | ConvertFrom-Json -Depth 8
} catch {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: JSON parse error: $_"
  exit 0
}

$filePath = [string]$payload.tool_input.file_path
Add-Content -Path $debugLog -Value "[$timestamp] file_path=$filePath"

if ([string]::IsNullOrWhiteSpace($filePath)) {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: empty file_path"
  exit 0
}

$normalizedFilePath = ($filePath -replace "\\", "/").ToLowerInvariant()
Add-Content -Path $debugLog -Value "[$timestamp] normalized=$normalizedFilePath"

if ($normalizedFilePath -notmatch "docs/feedback/claude\.md$") {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: path not matching docs/feedback/claude.md"
  exit 0
}

$cwd = [string]$payload.cwd
if ([string]::IsNullOrWhiteSpace($cwd)) {
  $cwd = "d:/claude-tools/.claude/mcp-servers/slack/next"
}

$cwd = $cwd -replace "\\", "/"
$claudePath = Join-Path $cwd "docs/feedback/claude.md"
if (-not (Test-Path $claudePath)) {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: file not found at $claudePath"
  exit 0
}

if (-not (Select-String -Path $claudePath -Pattern "\[GPT미검증\]" -Quiet)) {
  Add-Content -Path $debugLog -Value "[$timestamp] EXIT: no [GPT미검증] tag found"
  exit 0
}

Add-Content -Path $debugLog -Value "[$timestamp] MATCH: launching feedback-audit.mjs"

$escapedCwd = $cwd.Replace("'", "''")
$command = @"
`$env:FEEDBACK_LOOP_ACTIVE = '1'
Set-Location -LiteralPath '$escapedCwd'
node scripts/feedback-audit.mjs
"@

if ($env:FEEDBACK_HOOK_DRY_RUN -eq "1") {
  Write-Output "would-run: node scripts/feedback-audit.mjs"
  exit 0
}

Start-Process -FilePath "pwsh" -ArgumentList @(
  "-NoProfile",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  $command
) -WindowStyle Hidden | Out-Null

exit 0
