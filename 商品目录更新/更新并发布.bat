@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-catalog.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo.
pause
exit /b %EXITCODE%
