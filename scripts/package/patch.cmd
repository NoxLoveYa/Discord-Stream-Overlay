@echo off
rem Patches (or unpatches) Discord so that it loads the Vencord next to this file: the same as `pnpm inject`.
rem   patch.cmd -install -branch stable      (stable, ptb or canary)
rem   patch.cmd -repair -branch stable
rem   patch.cmd -uninstall -branch stable
setlocal
set "HERE=%~dp0"
set "VENCORD_USER_DATA_DIR=%HERE:~0,-1%"
set "VENCORD_DEV_INSTALL=1"
"%HERE%VencordInstallerCli.exe" %*
exit /b %ERRORLEVEL%
