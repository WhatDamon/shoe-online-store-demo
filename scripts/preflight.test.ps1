Describe 'production preflight' {
  BeforeAll {
    $scriptPath = Join-Path $PSScriptRoot 'preflight.ps1'
  }

  function Assert-Contains([string] $Text, [string] $Needle) {
    if ($Text -notlike "*$Needle*") {
      throw "Expected preflight output to contain $Needle"
    }
  }

  It 'rejects local and insecure production settings' {
    $env:NODE_ENV = 'production'
    $env:DB_DRIVER = 'sqlite'
    $env:DATABASE_URL = 'sqlite:///./data/local.db'
    $env:PG_SSL = '0'
    $env:PYTHON_API_URL = 'http://127.0.0.1:8000'
    $env:AI_SESSION_SECRET = 'short'
    $env:SHOPIFY_ENABLED = 'false'

    $output = (& pwsh -NoProfile -File $scriptPath -Environment production 2>&1 | Out-String)
    Assert-Contains $output 'AI_SESSION_SECRET'
    Assert-Contains $output 'DB_DRIVER'
    Assert-Contains $output 'DATABASE_URL'
    Assert-Contains $output 'PG_SSL'
    Assert-Contains $output 'PYTHON_API_URL'
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 1) { throw "Expected rejection exit code 1, got $exitCode" }
  }

  It 'accepts verified PostgreSQL and internal service configuration' {
    $env:NODE_ENV = 'production'
    $env:DB_DRIVER = 'postgres'
    $env:DATABASE_URL = 'postgresql://user:password@db.example/evoloop'
    $env:PG_SSL = 'verify-full'
    $env:PYTHON_API_URL = 'http://commerce.internal:8000'
    $env:AI_SESSION_SECRET = '01234567890123456789012345678901'
    $env:COMMERCE_PROXY_SECRET = 'abcdefghijklmnopqrstuvwxyz123456'
    $env:SHOPIFY_ENABLED = 'false'

    $output = (& pwsh -NoProfile -File $scriptPath -Environment production 2>&1 | Out-String)
    Assert-Contains $output 'configuration passed'
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "Expected success exit code 0, got $exitCode" }
  }

  AfterEach {
    @('NODE_ENV', 'DB_DRIVER', 'DATABASE_URL', 'PG_SSL', 'PYTHON_API_URL', 'AI_SESSION_SECRET', 'COMMERCE_PROXY_SECRET', 'SHOPIFY_ENABLED', 'PG_SSL_CA_FILE') |
      ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
  }
}
