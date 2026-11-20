@echo off
rem ============================================================
rem  GUILTY AS SOCK! — Scripter Edition • Играть в Windows
rem  Двойной клик по этому файлу = запуск игры в браузере.
rem  Друзья в той же Wi-Fi: ссылка покажется в консоли и в меню игры.
rem ============================================================
chcp 65001 >nul
title GUILTY AS SOCK! - Scripter Edition
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Не найден Node.js.
  echo     Скачай LTS с https://nodejs.org, установи и запусти этот файл снова.
  echo     Или скачай готовый EXE из GitHub Releases:
  echo     https://github.com/squezech-cmd/scripter/releases
  pause
  exit /b 1
)

if not exist node_modules (
  echo Устанавливаю зависимости (один раз)...
  call npm install || ( echo [!] npm install не удался & pause & exit /b 1 )
)

echo.
echo 🧦 GUILTY AS SOCK! — Scripter Edition
echo    Игра откроется в браузере: http://localhost:8080
echo    Онлайн для друзей: пункт «🌐 ИГРАТЬ С ДРУЗЬЯМИ» в меню
echo.
start "" http://localhost:8080
call npm start
pause
