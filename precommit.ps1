[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Assert-Command {
  param([Parameter(Mandatory = $true)][string]$CommandName)

  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $CommandName"
  }
}

function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  & corepack pnpm @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "corepack pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

Assert-Command node
Assert-Command corepack
Assert-Command git

Push-Location $RootDir
try {
  Write-Step 'Installing workspace dependencies'
  Invoke-Pnpm install --frozen-lockfile

  Write-Step 'Scanning production dependencies for known vulnerabilities'
  Invoke-Pnpm run security:deps

  Write-Step 'Scanning repository files for hard-coded secrets'
  Invoke-Pnpm run security:secrets

  Write-Step 'Applying lint fixes'
  Invoke-Pnpm run lint:fix

  Write-Step 'Running tests'
  Invoke-Pnpm test

  Write-Step 'Running full validation gate'
  Invoke-Pnpm check

  Write-Step 'Precommit checks passed'
}
finally {
  Pop-Location
}
