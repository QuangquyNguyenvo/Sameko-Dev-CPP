; Sameko Dev C++ - NSIS customisation, included by electron-builder (package.json > build.nsis.include).
; The wizard keeps its steps (Welcome, choose the folder, install, Finish); this file gives it the
; Kawaii Dark colours of scripts/build-installer-art.js and Sameko's own wording.
;
; The colours are set in customWelcomePage, not customHeader: electron-builder inserts
; customHeader after the pages are built, too late for them. Modern UI reads MUI_BGCOLOR and
; MUI_TEXTCOLOR when each page is inserted, so the Welcome page, the header strip and the Finish
; page that follow all take them.

!macro samekoColours
  !ifdef MUI_BGCOLOR
    !undef MUI_BGCOLOR
  !endif
  !define MUI_BGCOLOR "152535"
  !ifdef MUI_TEXTCOLOR
    !undef MUI_TEXTCOLOR
  !endif
  !define MUI_TEXTCOLOR "E0F0FF"
!macroend

; Sameko's own wording, per installer language (package.json > build.nsis.installerLanguages).
; Numeric LCIDs, as electron-builder's own LangStrings use: the languages are loaded after this.
; 1033 English, 1066 Vietnamese, 2052 Simplified Chinese.
!macro customHeader
  !ifndef MUI_HEADERIMAGE_RIGHT
    !define MUI_HEADERIMAGE_RIGHT
  !endif
  LangString samekoWelcomeTitle 1033 "Welcome to Sameko Dev C++"
  LangString samekoWelcomeTitle 1066 "Chào mừng đến với Sameko Dev C++"
  LangString samekoWelcomeTitle 2052 "欢迎使用 Sameko Dev C++"
  LangString samekoWelcomeText 1033 "A light C++ IDE for competitive programming and learning, with GCC 16, the GDB debugger and clangd built in. Nothing else to install.$\r$\n$\r$\nOn the next page, choose where to install it.$\r$\n$\r$\nClick Next to continue."
  LangString samekoWelcomeText 1066 "IDE C++ gọn nhẹ cho lập trình thi đấu và học tập, có sẵn GCC 16, trình gỡ lỗi GDB và clangd. Không cần cài thêm gì.$\r$\n$\r$\nỞ trang tiếp theo, hãy chọn nơi cài đặt.$\r$\n$\r$\nNhấn Tiếp để tiếp tục."
  LangString samekoWelcomeText 2052 "一款轻量的 C++ IDE，适用于算法竞赛与学习，内置 GCC 16、GDB 调试器和 clangd，无需另外安装任何东西。$\r$\n$\r$\n在下一页选择安装位置。$\r$\n$\r$\n点击“下一步”继续。"
  LangString samekoFinishTitle 1033 "Sameko Dev C++ is ready"
  LangString samekoFinishTitle 1066 "Sameko Dev C++ đã sẵn sàng"
  LangString samekoFinishTitle 2052 "Sameko Dev C++ 已准备就绪"
  LangString samekoFinishText 1033 "Everything it needs, the GCC compiler included, is in the folder you chose.$\r$\n$\r$\nHappy coding!"
  LangString samekoFinishText 1066 "Mọi thứ cần thiết, kể cả trình biên dịch GCC, đều nằm trong thư mục bạn đã chọn.$\r$\n$\r$\nChúc bạn code vui!"
  LangString samekoFinishText 2052 "所需的一切（包括 GCC 编译器）都已安装在你选择的文件夹中。$\r$\n$\r$\n编程愉快！"
  LangString samekoUpdatingTitle 1033 "Updating ${PRODUCT_NAME}..."
  LangString samekoUpdatingTitle 1066 "Đang cập nhật ${PRODUCT_NAME}..."
  LangString samekoUpdatingTitle 2052 "正在更新 ${PRODUCT_NAME}..."
  LangString samekoUpdatingText 1033 "Reopens in about a minute."
  LangString samekoUpdatingText 1066 "Tự mở lại sau khoảng 1 phút."
  LangString samekoUpdatingText 2052 "约一分钟后自动重新打开。"
!macroend

; "Restart to update" (app/services/auto-update-service.js) runs this installer with --updated
; --force-run and no /S: the wizard skips every page but the progress bar, then starts the app.
; Nothing to click, and the minute it takes to replace ~700 MB of files is visibly progress.
; Up to 1.4.x the app ran it silently (/S), with no window at all; for those updates the
; Banner plugin shows a small "Updating..." box instead.
!macro customInstallMode
  ${if} ${isUpdated}
    ${if} $hasPerMachineInstallation == "1"
      StrCpy $isForceMachineInstall "1"
    ${else}
      StrCpy $isForceCurrentInstall "1"
    ${endif}
  ${endif}
!macroend

; The default finish page (assistedInstaller.nsh), skipped on an update.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif
  !insertmacro skipPageIfUpdated
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customInit
  ${if} ${isUpdated}
  ${andIf} ${Silent}
    Banner::show /set 76 "$(samekoUpdatingTitle)" "$(samekoUpdatingText)"
  ${endIf}
!macroend

!macro customInstall
  ${if} ${isUpdated}
    ${if} ${Silent}
      Banner::destroy
    ${elseIf} ${isForceRun}
      ; The skipped finish page would have offered to run it; installSection.nsh only starts
      ; the app itself for a silent install.
      HideWindow
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
    ${endif}
  ${endIf}
!macroend

!macro customWelcomePage
  !insertmacro samekoColours
  !insertmacro skipPageIfUpdated
  !define MUI_WELCOMEPAGE_TITLE "$(samekoWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(samekoWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_FINISHPAGE_TITLE "$(samekoFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(samekoFinishText)"
!macroend
