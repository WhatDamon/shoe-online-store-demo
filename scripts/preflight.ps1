[CmdletBinding()]
param(
  [ValidateSet('development', 'production')]
  [string] $Environment = $(if ($env:NODE_ENV) { $env:NODE_ENV } else { 'development' })
)

$ErrorActionPreference = 'Stop'
$failures = [System.Collections.Generic.List[string]]::new()

function Add-Failure([string] $Message) {
  $failures.Add($Message)
}

function Is-Truthy([string] $Value) {
  return $Value -in @('1', 'true', 'yes')
}

function Is-PostgresUrl([string] $Value) {
  return $Value -match '^postgres(?:ql)?://'
}

function Is-LoopbackUrl([string] $Value) {
  try {
    $uri = [Uri]$Value
    return $uri.Host -in @('127.0.0.1', 'localhost', '::1')
  } catch {
    return $false
  }
}

if ($Environment -eq 'production') {
  if ([string]::IsNullOrWhiteSpace($env:AI_SESSION_SECRET) -or
      [Text.Encoding]::UTF8.GetByteCount($env:AI_SESSION_SECRET) -lt 32) {
    Add-Failure 'AI_SESSION_SECRET must contain at least 32 bytes in production.'
  }

  if ($env:DB_DRIVER -ne 'postgres') {
    Add-Failure 'DB_DRIVER must be postgres in production.'
  }

  if (-not (Is-PostgresUrl $env:DATABASE_URL)) {
    Add-Failure 'DATABASE_URL must be a PostgreSQL URL in production.'
  }

  if ($env:PG_SSL -notin @('1', 'true', 'require', 'verify-full')) {
    Add-Failure 'PG_SSL must enable certificate verification in production.'
  }

  if (-not [string]::IsNullOrWhiteSpace($env:PYTHON_API_URL) -and
      (Is-LoopbackUrl $env:PYTHON_API_URL)) {
    Add-Failure 'PYTHON_API_URL must not point to loopback in production.'
  }
}

if (Is-Truthy $env:SHOPIFY_ENABLED) {
  Add-Failure 'SHOPIFY_ENABLED=true is outside this MVP; keep the compatibility purchase path disabled.'
}

if ($env:PG_SSL -in @('0', 'false')) {
  if ($Environment -eq 'production' -or -not [string]::IsNullOrWhiteSpace($env:PG_SSL_CA_FILE)) {
    Add-Failure 'PG_SSL plaintext mode is development-only and cannot be combined with PG_SSL_CA_FILE.'
  }
}

if (-not [string]::IsNullOrWhiteSpace($env:PG_SSL_CA_FILE) -and -not (Test-Path -LiteralPath $env:PG_SSL_CA_FILE -PathType Leaf)) {
  Add-Failure 'PG_SSL_CA_FILE must point to a readable certificate bundle.'
}

if ($failures.Count -gt 0) {
  $failures | ForEach-Object { "preflight: $_" }
  exit 1
}

Write-Output "preflight: $Environment configuration passed without printing secrets."
