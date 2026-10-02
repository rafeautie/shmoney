### First launch
The builds are not signed with a paid developer certificate yet, so your OS asks you to confirm the first time you open shmoney:
* **macOS:** open shmoney once and close the warning, then go to **System Settings → Privacy & Security** and click **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/shmoney.app` in Terminal.
* **Windows:** if SmartScreen says it protected your PC, click **More info → Run anyway**.
* **Linux:** install the `.deb`, or make the AppImage executable with `chmod +x shmoney-*.AppImage`.
