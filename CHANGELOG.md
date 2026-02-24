# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [1.0.4] - 2026-02-15

### Added
- **[[FEATURE] Syntax highlighting for special characters (\\n, \\t, \\0) (Fixes #25)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/25)**: Added highlighting for escaped special characters.
- **[[FEATURE] Adjustable Font Size for Input, Output, and Terminal panels (Fixes #23)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/23)**: Added font size controls for Input, Output, and Terminal panels.

### Fixed
- **[[BUG] Enter key intermittently fails to insert new line after brace (Fixes #26)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/26)**: Fixed intermittent newline insertion after brace.
- **[[BUG] Menu shortcut label does not update after customization (Fixes #24)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/24)**: Menu shortcut labels now refresh after customization.
- **Monaco color scheme**: Adjusted Monaco editor color palette for better consistency.

## [1.0.3] - 2026-02-23

### Added
- **Custom Confirm Popup**: Replaced native browser `confirm()` dialogs with custom, theme-aware confirmation modals with smooth animation and backdrop blur.
- **Delete All Test Cases**: Added "Delete All" button in TESTS panel header to quickly remove all test cases at once.
- **Per-Test Delete Button**: Each test case now shows a delete button on hover for quick individual removal.
- **Test Result Diff on Switch**: Selecting a test case after "Run All" now displays the expected vs actual output diff inline.
- **Auto-Expand TESTS Panel**: Problems panel automatically expands when test cases are present, similar to docked terminal behavior.

### Fixed
- **[[BUG] Testcase result shows "Failed" even when Expected aligns with Input (Fixes #22)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/22)**:
  - *Case 2*: Fixed Permission Denied error when closing tab (Ctrl+W) while a program is running — process is now stopped before closing.
  - *Case 3*: Synced disable state between main terminal input and docked terminal input to prevent ambiguous input sources.
  - *Case 4*: Fixed keyboard input freeze after deleting all test cases — editor focus is now restored properly.
- **[[BUG] Unsaved changes indicator (dot) appears on unchanged files (Fixes #21)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/21)**: Corrected file change detection to prevent false-positive unsaved indicators.
- **[[BUG] Expected output panel incorrectly displays input data (Fixes #20)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/20)**: Fixed panel data binding to properly show expected output instead of input.
- **[[BUG] Remaining Vietnamese Strings (Fixes #19)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/19)**: Completed localization by translating remaining Vietnamese strings to English.
- **[[BUG] Output buffering: Input prompts appear after user input in C programs (Fixes #18)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/18)**: Improved terminal buffer handling to ensure proper prompt/input ordering.
- **[[UI] Window size and position resets on restart (Fixes #16)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/16)**: Window bounds are now persisted and restored correctly across sessions.
- **[[Editor] Auto-indentation missing after control statements (if/loop) (Fixes #15)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/15)**: Fixed automatic indentation after control structures.
- **Native Confirm Dialog Blocking Input**: Fixed issue where native confirm dialogs would block all input until window regain focus via alt-tab.
- **Auto-Update Stuck at 100%**: Fixed issue where auto-update would get stuck at 100% download progress for unsigned builds due to signature verification error.
- **Panel Gap After Undocking**: Fixed empty space appearing in TESTS panel after undocking terminal or I/O.

### Improved
- **Lazy Loading Optimization**: Implemented lazy loading for Monaco Editor to prevent initialization conflicts and reduce startup time.
- **Input/Output Color Scheme**: Enhanced color differentiation between input and output panels for better readability.
- **Terminal Buffer Optimization**: Improved buffer management and input handling performance for faster and more responsive text input.
- **Confirm Dialog UX**: All confirmation dialogs now use theme-aware styling with CSS variables, ensuring proper contrast across all themes (including Sakura).
- **Sakura Theme Test Results**: Improved text contrast for test result status, summary stats, and action buttons on light backgrounds.
- **Performance Enhancements**: General performance optimizations for smoother operation.

## [1.0.2] - 2026-01-31

### Added
- **Auto-Update UI**: Added download progress bar to the update notification to show download status clearly.
- **Update Optimization**: Optimized the update process for better reliability.

### Fixed
- **[[BUG] Shortcut customization not working (Fixes #14)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/14)**: Resolved issue where custom keybindings were not being saved/applied correctly.
- **[[BUG] Random keyboard input freeze in editor (Fixes #13)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/13)**: Fixed intermittent input freezing requiring restart.
- **[[BUG] Linker/Build error when switching C++ versions quickly (Fixes #12)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/12)**: Fixed race condition by using settings snapshot during build and deferring compiler settings changes until build completes.
- **[[BUG] Test Detail View ignores trailing output (Fixes #10)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/10)**: Corrected output comparison logic to handle trailing output/whitespace properly.
- **[[BUG] Lỗi bản portable (Fixes #9)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/9)**: Addressed issues with the portable distribution build.

### Improved
- **Video Background Performance**: Video backgrounds now pause when window loses focus, reducing CPU/GPU usage when alt-tabbing.
- **Theme Customizer Cleanup**: Fixed potential video memory leak when closing theme customizer with video preview.
- **CSS Transition Optimization**: Replaced ~50 instances of `transition: all` with specific properties, reducing browser repaint overhead during hover/active states.
- **Panel Resizer Throttling**: Added requestAnimationFrame throttling to panel resize handlers for smoother dragging.

## [1.0.1] - 2026-01-29

### Fixed
- **[[Performance] High CPU/Memory usage or UI Lag observed (Fixes #6)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/6)**:
    - Implemented `Performance Mode` which optimizes background rendering (using `scroll` instead of `fixed` attachment) to reduce repaint lag.
    - Disabled heavy visual effects like `backdrop-filter` and minimap rendering in Performance Mode.
    - Limited terminal buffer size to 1000 lines to prevent DOM overload.
- **[[UI] Background Blur setting has no effect on main window (Fixes #5)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/5)**: Adjusted window transparency handling and backdrop filter application.
- **[[BUG] G++ fails to initialize on startup on specific machines (Fixes #4)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/4)**: Improved compiler path detection and initialization logic (LLD linker adjustments).
- **[[BUG] Created snippets do not trigger/expand (Fixes #3)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/3)**: Fixed snippet registration logic to correctly load user-defined snippets from `App.settings`.
- **[[BUG] Competitive Companion parser does not load template (Fixes #2)](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues/2)**: Fixed issue where the default code template was not applying when receiving problems from OJ.


### Added
- **External Terminal Integration**: Launch external terminal for interactive debugging and testing
- **Video Background Support**: Use custom video files as editor background with opacity control
- **Enhanced C++ IntelliSense**: Improved suggestions for STL functions, keywords, and common patterns
- **Performance Optimizations**: Faster compilation, improved editor responsiveness, optimized memory usage

### Changed
- Bundled GCC/MinGW compiler included in all distributions for seamless setup
- Improved theme rendering and editor performance

### Fixed
- Various stability improvements and bug fixes from beta releases

## [1.0.0-beta.9] - 2026-01-18

### Added
- **Documentation Overhaul**: Rewrote README, CONTRIBUTING with wiki-style format
- **Visual Badges**: New Wiki, Download, Website buttons in Sameko ocean style
- **Batch Testing UI**: Enhanced competitive programming test runner

### Changed
- **Modular Architecture**: Refactored main.js into app/ directory structure
- **PCH Logging**: Clearer precompiled header build status messages

### Fixed
- Various UI stability improvements and theme consistency fixes

## [1.0.0-beta.8] - 2026-01-01

### Added
- Maintenance release for stability improvements.
- Updated dependencies and internal optimizations.

## [1.0.0-beta.7] - 2025-12-29

### Added
- **AStyle Integration**: Professional C++ code formatting with `Ctrl + Shift + A`.
- **Auto-Save**: Customizable auto-save functionality with configurable intervals.
- **Template Manager**: Create and manage code templates for new files.
- **Custom Keybindings**: Ability to redefine shortcuts for various IDE actions.

## [1.0.0-beta.6] - 2025-12-28

### Added
- **Snippet Editor**: Built-in tool to create and manage custom IntelliSense code snippets.
- **IntelliSense Enhancements**: Improved keyword and snippet suggestions.
- **UI Glitches Fixes**: Improved modal backgrounds and theme consistency.

## [1.0.0-beta.5] - 2025-12-22

### Added
- **Smart Header Linking**: Automatically detects and links corresponding `.cpp` files when using `#include "header.h"`.
- **File Watcher**: Real-time detection of external file changes with prompt to reload.
- **Multi-file Compilation**: Improved handling of projects with multiple source files.

## [1.0.0] - 2025-12-14

### Added
- Initial release
- Monaco Editor integration with C++ syntax highlighting
- Multi-tab file management
- Split editor support
- Integrated terminal with interactive I/O
- Input/Expected output panels for testing
- Problems panel for compilation errors
- Kawaii Ocean theme (light and dark variants)
- Dracula theme
- Precompiled headers (PCH) support for faster compilation
- Customizable settings:
  - Font size and family
  - Tab size
  - Minimap toggle
  - Word wrap
  - C++ standard selection (C++11/14/17/20)
  - Optimization level
  - Time limit for execution
  - Custom background image
  - Accent color
- Keyboard shortcuts for all major actions
- Custom frameless window with native controls
