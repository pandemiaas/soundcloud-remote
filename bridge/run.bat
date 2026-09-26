@echo off
rem SoundCloud Remote — мост: запуск без консольного окна
cd /d "%~dp0"

where pythonw >nul 2>nul
if %errorlevel%==0 (
    set "PYW=pythonw"
) else (
    if exist "%LocalAppData%\Programs\Python\Python312\pythonw.exe" (
        set "PYW=%LocalAppData%\Programs\Python\Python312\pythonw.exe"
    ) else (
        echo Python не найден. Установите с python.org и перезапустите.
        pause
        exit /b 1
    )
)

start "" "%PYW%" main.py
