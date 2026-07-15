; Uninstall step: offer to delete all user data (database, LLM models, caches).
; The default uninstaller never touches %APPDATA%\shmoney, so reinstalls keep
; the user's data; this adds an explicit opt-in wipe. Skipped when the
; uninstaller runs as part of an auto-update, and silent uninstalls keep the
; data (/SD IDNO) so scripted updates/removals can never wipe it.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION \
      "Also delete all shmoney data?$\r$\n$\r$\nThis permanently removes every account, transaction, budget, and downloaded AI model on this computer. There is no cloud copy." \
      /SD IDNO IDNO keepUserData
    SetShellVarContext current
    RMDir /r "$APPDATA\${APP_FILENAME}"
    keepUserData:
  ${endif}
!macroend
