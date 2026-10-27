@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22.13 or newer first. & exit /b 1)
call npm ci --prefix "%~dp0qq-bridge-enhanced-v1.0.0"
if errorlevel 1 exit /b 1
node scripts/manage.mjs setup
