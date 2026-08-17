# Windows setup helper. Equivalent to `make setup && make up && make seed`.
# Run from the repository root in PowerShell:  .\setup.ps1
#
# Safe to re-run. Each step checks whether its work is already done.

$ErrorActionPreference = 'Stop'

function Step($n, $text) { Write-Host "$n  $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Fail($text) { Write-Host "    $text" -ForegroundColor Red }

# --- 0. Docker ---------------------------------------------------------------
# Checked first, because it is the one prerequisite this script cannot install
# for you, and finding out at step 3 wastes several minutes.
Step '0/5' 'Checking Docker...'
$dockerExe = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerExe) {
  Fail 'Docker is not installed.'
  Write-Host ''
  Write-Host '    Install Docker Desktop from https://www.docker.com/products/docker-desktop/'
  Write-Host '    and run this script again.'
  Write-Host ''
  Write-Host '    Or run without Docker against your own PostgreSQL 16:'
  Write-Host '      see the "Without Docker" section of README.md'
  exit 1
}

docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  Fail 'Docker is installed but the engine is not running.'
  Write-Host ''
  Write-Host '    Start Docker Desktop, wait for the whale icon in the system tray to'
  Write-Host '    stop animating, then run this script again.'
  exit 1
}
Ok 'Docker engine is running'

# --- 1. Dependencies ---------------------------------------------------------
Step '1/5' 'Installing dependencies...'
# corepack writes shims into the Node install directory, which needs
# administrator rights on a default Windows install. pnpm usually already works
# without it, so a failure here is not fatal.
try { corepack enable 2>&1 | Out-Null } catch { Warn 'corepack enable needs admin rights; continuing' }

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Warn 'pnpm not found, installing it globally with npm'
  npm install -g pnpm@9.15.9
  if ($LASTEXITCODE -ne 0) { Fail 'Could not install pnpm.'; exit 1 }
}

pnpm install
if ($LASTEXITCODE -ne 0) { Fail 'pnpm install failed. Read the output above.'; exit 1 }
Ok 'dependencies installed'

# --- 2. Local config ---------------------------------------------------------
Step '2/5' 'Preparing local config...'
if (-not (Test-Path 'apps/api/.env')) {
  Copy-Item 'apps/api/.env.example' 'apps/api/.env'
  Ok 'created apps/api/.env from the example'
}
pnpm --filter '@kode/contracts' build
if ($LASTEXITCODE -ne 0) { Fail 'Building the shared contracts package failed.'; exit 1 }
pnpm --filter '@kode/api' exec prisma generate
if ($LASTEXITCODE -ne 0) { Fail 'Generating the Prisma client failed.'; exit 1 }
Ok 'contracts built and Prisma client generated'

# --- 3. Containers -----------------------------------------------------------
Step '3/5' 'Starting Postgres, Mailpit and the API in Docker...'
Write-Host '    First run pulls images and builds the API. This can take a few minutes.'
docker compose -f docker-compose.dev.yml up -d --build
if ($LASTEXITCODE -ne 0) {
  Fail 'docker compose failed. Read the output above.'
  exit 1
}

# --- 4. Wait for readiness ---------------------------------------------------
Step '4/5' 'Waiting for the API...'
$ready = $false
foreach ($i in 1..60) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing 'http://localhost:4000/api/v1/health/ready' -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $ready = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) {
  Fail 'The API did not become ready within two minutes.'
  Write-Host ''
  Write-Host '    See what it said:'
  Write-Host '      docker compose -f docker-compose.dev.yml logs api'
  Write-Host ''
  Write-Host '    Check what is holding the published ports:'
  Write-Host '      Get-NetTCPConnection -LocalPort 55432,4000 -ErrorAction SilentlyContinue'
  exit 1
}
Ok 'API is ready on http://localhost:4000'

# --- 5. Seed -----------------------------------------------------------------
# Run inside the API container. It already holds tsx, the Prisma CLI, the schema
# and the seed script, and it reaches the database over the compose network, so
# this works whether or not the host can talk to Postgres directly.
Step '5/5' 'Seeding demo data...'
docker compose -f docker-compose.dev.yml exec -T api ./node_modules/.bin/tsx prisma/seed.ts
if ($LASTEXITCODE -ne 0) { Fail 'Seeding failed. Read the output above.'; exit 1 }
Ok 'demo data loaded'

# --- host database access (informational) ------------------------------------
# Not needed for anything above, but `pnpm db:studio` and psql clients do use it.
$hostDb = Test-NetConnection -ComputerName localhost -Port 55432 -InformationLevel Quiet -WarningAction SilentlyContinue
if (-not $hostDb) {
  Warn 'The host cannot reach the database on port 55432.'
  Warn 'Everything above still works. Only host tools such as `pnpm db:studio` need it.'
}

Write-Host ''
Write-Host 'Ready. Start the two frontends with:' -ForegroundColor Green
Write-Host "  pnpm --parallel --filter '@kode/portal' --filter '@kode/admin' dev"
Write-Host ''
Write-Host '  Portal   http://localhost:5173'
Write-Host '  CMS      http://localhost:5174'
Write-Host '  API docs http://localhost:4000/api/docs'
Write-Host '  Mail     http://localhost:8025'
Write-Host ''
Write-Host '  Sign in with admin@kodesportsclub.com / KodeClub!2026demo'
Write-Host '  All five demo accounts are listed in README.md'
