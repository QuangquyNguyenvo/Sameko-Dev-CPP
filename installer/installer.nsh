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
!macroend

!macro customWelcomePage
  !insertmacro samekoColours
  !define MUI_WELCOMEPAGE_TITLE "$(samekoWelcomeTitle)"
  !define MUI_WELCOMEPAGE_TEXT "$(samekoWelcomeText)"
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_FINISHPAGE_TITLE "$(samekoFinishTitle)"
  !define MUI_FINISHPAGE_TEXT "$(samekoFinishText)"
!macroend
