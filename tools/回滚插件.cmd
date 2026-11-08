@echo off
chcp 65001 >nul
echo 正在从 DSH profile 移除 dsh-yourdeepfish ...
cd /d "%~dp0.."
node tools\plugin-register.js off
echo.
echo 完成。请重新启动 DeepSeek Harness。
pause
