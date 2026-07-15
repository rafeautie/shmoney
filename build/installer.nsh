; Uninstall step: offer to delete all user data (database, LLM models, caches).
; The default uninstaller never touches %APPDATA%\shmoney, so reinstalls keep
; the user's data; this adds an explicit opt-in wipe.
;
; One-click uninstallers force silent mode before the uninstall section runs
; (see electron-builder's uninstaller.nsh un.onInit), which auto-answers any
; MessageBox that declares an /SD default. So instead of /SD we gate on the
; /S flag itself: absent = a human ran the uninstaller (show the prompt;
; MessageBox without /SD still displays in silent mode), present = an update
; or scripted uninstall (skip entirely, never delete). isUpdated is a second
; guard for updates.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "/S" $R8
    ${if} ${Errors}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION \
        "Also delete all shmoney data?$\r$\n$\r$\nThis permanently removes every account, transaction, budget, and downloaded AI model on this computer. There is no cloud copy." \
        IDNO keepUserData
      SetShellVarContext current
      RMDir /r "$APPDATA\${APP_FILENAME}"
      keepUserData:
    ${endif}
  ${endif}
!macroend
