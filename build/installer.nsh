; Partes do instalador (NSIS) do UnusHub, incluídas pelo electron-builder.
;
; Ao desinstalar (não nas atualizações, que reinstalam por cima), se o efeito do
; microfone estiver instalado no Windows, pergunta se remove também. Quem remove é o
; efeito-unushub.exe, que precisa de administrador e pede a permissão ao Windows por
; conta própria. O programa é copiado no começo do desinstalador, antes de os
; arquivos do app serem apagados.

!macro customUnInit
  ${ifNot} ${isUpdated}
    InitPluginsDir
    CopyFiles /SILENT "$INSTDIR\resources\native\audio-mix\build\efeito-unushub.exe" "$PLUGINSDIR\efeito-unushub.exe"
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; O efeito está registrado no Windows? (mesmo CLSID desde a primeira versão)
    ReadRegStr $0 HKLM "SOFTWARE\Classes\AudioEngine\AudioProcessingObjects\{6B1F3C2A-8E4D-4F7B-9A15-3C2D7E9F0A41}" "FriendlyName"
    ${if} $0 != ""
    ${andIf} ${FileExists} "$PLUGINSDIR\efeito-unushub.exe"
      ; Pergunta no idioma do instalador, que segue o do Windows (1046 pt-BR, 3082 es, resto inglês).
      StrCpy $1 "The UnusHub audio effect is installed on the microphone.$\r$\n$\r$\nRemove it too? The microphone effects go back to how they were. Windows will ask for administrator permission and sound stops for a few seconds."
      ${if} $LANGUAGE == 1046
        StrCpy $1 "O efeito de áudio do UnusHub está instalado no microfone.$\r$\n$\r$\nRemover também? Os efeitos do microfone voltam a ser como eram antes. O Windows vai pedir permissão de administrador e o som para por alguns segundos."
      ${elseIf} $LANGUAGE == 3082
        StrCpy $1 "El efecto de audio de UnusHub está instalado en el micrófono.$\r$\n$\r$\n¿Quitarlo también? Los efectos del micrófono vuelven a ser como antes. Windows pedirá permiso de administrador y el sonido se detiene unos segundos."
      ${endIf}
      MessageBox MB_YESNO|MB_ICONQUESTION "$1" /SD IDNO IDNO unusSkipEffect
        ExecWait '"$PLUGINSDIR\efeito-unushub.exe" --remover'
      unusSkipEffect:
    ${endIf}
  ${endIf}
!macroend
