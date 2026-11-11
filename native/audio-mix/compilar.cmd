@echo off
rem Compila o efeito de áudio (DLL) e a ponte (x64) com o Visual Studio Build Tools.
rem Saída em native\audio-mix\build (fora do git). Precisa do Build Tools com C++ e do SDK do Windows.
setlocal
cd /d "%~dp0"
set VCVARS=
for /f "usebackq delims=" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath`) do set VCVARS=%%i\VC\Auxiliary\Build\vcvars64.bat
if not exist "%VCVARS%" (echo Visual Studio Build Tools com C++ nao encontrado. & exit /b 1)
call "%VCVARS%" >nul || exit /b 1
if not exist build mkdir build
cl /nologo /O2 /EHsc /W4 /utf-8 /wd4815 /LD /Fo:build\ /Fe:build\UniHubAudioMix.dll efeito\MixApo.cpp efeito\TipoDeAudio.cpp /link /DEF:efeito\MixApo.def audiobaseprocessingobject.lib advapi32.lib ole32.lib || exit /b 1
cl /nologo /O2 /EHsc /W4 /utf-8 /Fo:build\ /Fe:build\ponte.exe ponte\ponte.cpp || exit /b 1
cl /nologo /O2 /EHsc /W4 /utf-8 /Fo:build\ /Fe:build\saidas.exe saidas\saidas.cpp /link ole32.lib advapi32.lib || exit /b 1
del /q build\*.obj build\*.exp build\*.lib 2>nul
echo Compilado em %~dp0build
