# Production preflight boundary

The root preflight now requires an explicit `APP_ENV=production` whenever it is
run with `-Environment production`. This keeps the build-time gate aligned with
the Python service, which rejects a production process that is downgraded to
development mode.

The gate still checks PostgreSQL, certificate verification, server-only secret
length, the non-loopback Python service URL, and the disabled Shopify path. It
only reads process environment variables and never prints their values.

Verification for this change is recorded in the commit that adds the gate:

```powershell
$env:APP_ENV = 'production'
npm run preflight -- -Environment production
Invoke-Pester -Path scripts/preflight.test.ps1
```

This is a configuration check. It does not prove that the configured certificate,
proxy, service hostname, or deployment is reachable.
