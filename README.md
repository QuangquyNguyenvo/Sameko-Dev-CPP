<img src="src/assets/docs/readme-header.svg" width="100%" />

<div align="center">
  <br />
  <img src="src/assets/vectors/logo.svg" alt="Sameko Logo" width="650" />
  <br />

  # 🐟 Sameko IDE ⚓
  
  **The cutest & fastest C++ IDE for your coding adventures! (≧◡≦) ♡**

  <p>
    <a href="https://sameko.dev/" target="_blank" rel="noopener noreferrer">
      <img src="https://img.shields.io/badge/Download-Sameko%20IDE-88c9ea?style=for-the-badge&labelColor=1a2530" alt="Download" />
    </a>
    <a href="https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/QuangquyNguyenvo/Sameko-Dev-CPP?style=for-the-badge&color=88c9ea&labelColor=1a2530" alt="License" />
    </a>
    <a href="https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP">
      <img src="https://img.shields.io/github/stars/QuangquyNguyenvo/Sameko-Dev-CPP?style=for-the-badge&color=88c9ea&labelColor=1a2530" alt="Stars" />
    </a>
  </p>
</div>

<br />

<div align="center">
  ★ 。＼｜／。★
  <br/>
  <b>Welcome to the deep blue sea of coding! 🌊</b>
  <br/>
  ★ 。／｜＼。★
</div>

<br />

<div align="center">
  <img src="src/assets/vectors/divider.svg" width="80%" alt="divider" />
</div>

<br />

<div align="center">
  <p>
    <a href="#-features">Features</a> •
    <a href="#-screenshots">Screenshots</a> •
    <a href="#-download">Download</a> •
    <a href="#-development">Development</a> •
    <a href="#-shortcuts">Shortcuts</a>
  </p>
</div>

<br />

## 🎯 About

<table>
  <tr>
    <td width="70%">
      <p><b>Sameko IDE</b> is a lightweight C++ IDE for Windows and Linux, built for competitive programming and learning. The Windows build comes with GCC 16 pre-configured — no MinGW installation needed. Just download, extract, and start coding.</p>
      <blockquote>💡 Think of it as a modern Dev-C++ alternative: simple interface, fast compilation, works out of the box.</blockquote>
    </td>
    <td width="30%" align="center">
      <img src="src/assets/icons/fish.png" alt="Sameko Fish" width="180" />
    </td>
  </tr>
</table>

<br />

## ✨ Features

- 🚀 GCC 16 bundled on Windows, no setup required (on Linux it uses your distro's `g++`)
- ⚡ Press F11 to compile and run instantly
- 🐞 Real GDB debugger: breakpoints, watches, STL-aware variable trees, and an **Auto dry run** that walks your program line by line on its own
- 🏆 Fetch test cases from Codeforces, AtCoder, LeetCode via Competitive Companion
- 🔗 Auto-links .cpp files when you `#include` custom headers
- 🎨 6 themes: Kawaii, Dracula, Monokai, Nord, One Dark, Sakura
- 📑 Multi-tab editor with split view
- ✂️ Custom snippets and templates (BFS, DFS, Segment Tree, etc.)
- 🧹 Format code with AStyle (`Ctrl+Shift+A`)
- 💾 Auto-save with configurable intervals
- 👁️ File watcher detects external changes

<br />

## 📸 Screenshots

<div align="center">
  <img src="src/assets/screenshots/preview.gif" alt="Sameko IDE Demo" width="100%" />
  <br /><br />
  <img src="src/assets/screenshots/welcome.png" alt="Welcome Screen" width="48%" />
  <img src="src/assets/screenshots/editor.png" alt="Main Editor" width="48%" />
  <br />
  <img src="src/assets/screenshots/customizer.png" alt="Theme Customizer" width="48%" />
  <img src="src/assets/screenshots/settings.png" alt="Settings" width="48%" />
</div>

<br />

## 🆕 What's New in v1.2.0

- **A real debugger.** Breakpoints in the gutter, watches, STL-aware variable trees, call stack, hover-to-evaluate, Run to Cursor — all on the bundled GDB.
- **Auto dry run.** One button walks your program a line at a time while the values update, so you can watch a loop run instead of pressing F10 a hundred times. No breakpoint needed; it starts at `main()`.
- **Step back through a recording.** Every pause is recorded, so **Back** lets you look at the previous steps and the values they held.
- **Linux support.** AppImage, `.deb` and `.tar.gz` builds.
- **Realtime output** — `cout`/`printf` appear line by line while the program runs, not all at once when it exits.
- **Clangd-powered IntelliSense**, replacing the old hardcoded STL tables.
- **Faster startup**: Monaco loads on demand and ~115 MB of never-used files were dropped from the package.

See [CHANGELOG.md](CHANGELOG.md) for the full list.

### Multi-file project note

If your project is split across multiple `.cpp` files and you see linker errors like `undefined reference`, open:

- `Settings > Compiler > Single-file Compile Mode`

Then turn it **OFF** and build again.

## 📥 Download

Get the latest build from [**sameko.dev**](https://sameko.dev/) or the
[GitHub releases page](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/releases).

### Windows

| File | What it is |
| :--- | :--- |
| `sameko-dev-cpp-setup-<version>.exe` | Installer. Adds shortcuts and receives auto-updates. **Pick this if unsure.** |
| `sameko-dev-cpp-<version>-portable.zip` | Portable build. Extract it anywhere — including a USB stick — and run `Sameko Dev C++.exe`. |

> **The compiler is bundled** on Windows (GCC 16). Nothing else to install.

### Linux

The Linux build **does not bundle a compiler** — Sameko uses the `g++` and `gdb` already on your
system. Install them first:

```bash
# Debian / Ubuntu / Mint / Pop!_OS
sudo apt update && sudo apt install g++ gdb

# Fedora
sudo dnf install gcc-c++ gdb

# Arch / Manjaro
sudo pacman -S gcc gdb
```

Then pick one of the three packages:

**AppImage** — works on any distribution, nothing to install:

```bash
chmod +x sameko-dev-cpp-*-linux-*.AppImage
./sameko-dev-cpp-*-linux-*.AppImage
```

> If it will not start, your distribution may be missing FUSE 2:
> `sudo apt install libfuse2` (Ubuntu 22.04+), or run it with `--appimage-extract-and-run`.

**`.deb`** — for Debian, Ubuntu and derivatives:

```bash
sudo apt install ./sameko-dev-cpp-*-linux-*.deb
# then launch "Sameko Dev C++" from your app menu, or run:
sameko-dev-cpp
```

**`.tar.gz`** — a plain folder, no installation:

```bash
tar -xzf sameko-dev-cpp-1.2.0-linux-x64.tar.gz
cd sameko-dev-cpp-1.2.0-linux-x64
./sameko-dev-cpp
```

> **Sandbox note:** if it exits immediately with a `chrome-sandbox` / `SUID sandbox` error — most
> likely on distributions that restrict unprivileged user namespaces, such as Ubuntu 24.04+ — fix
> the helper's permissions inside the extracted folder:
>
> ```bash
> sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox
> ```
>
> The `.deb` package does this for you at install time. As a last resort, start the app with
> `--no-sandbox`.

Settings, local history and snippets live in `~/.config/sameko-dev-cpp/`.

<br />

## 🛠️ Development

### Prerequisites
- Node.js v18+
- npm or yarn
- On Linux: `g++` and `gdb` (see [Linux](#linux) above)

### Setup

```bash
# Clone the repository
git clone https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP.git
cd Sameko-Dev-CPP

# Install dependencies
npm install

# Run in development mode
npm start
```

### Building

```bash
npm run build        # the three release artifacts: Windows installer + portable .zip + Linux AppImage
npm run build:win    # Windows only
npm run build:linux  # AppImage + .deb + .tar.gz  (run this on Linux or WSL)
npm run build:all    # everything, in one pass
```

Everything lands in `samekodevcpp/`. A full `npm run build` produces:

| Artifact | Notes |
| :--- | :--- |
| `sameko-dev-cpp-setup-<version>.exe` | Windows installer (NSIS) |
| `sameko-dev-cpp-<version>-portable.zip` | Windows portable folder, zipped |
| `sameko-dev-cpp-<version>-linux-x86_64.AppImage` | Linux, runs on any distribution |
| `latest.yml` + `.blockmap` | Update metadata the in-app updater reads |

> **How the AppImage gets built on Windows.** Packing an AppImage requires creating symlinks, which
> Windows only allows from an elevated terminal or with Developer Mode on; otherwise electron-builder
> stops at `A required privilege is not held by the client`. `scripts/build-appimage.js` checks for
> that permission up front and, when it is missing, runs the same build **through WSL** — which has
> no such restriction and can build in place from `/mnt/<drive>`. So `npm run build` produces all
> three artifacts on a plain terminal as long as WSL is installed; if it is not, the script prints
> every way to fix it. The Windows targets are built first either way, so they survive a Linux-side
> failure.
>
> `.deb` additionally needs `fpm`, which has no Windows build — run `npm run build:linux` inside WSL
> or on a real Linux machine for the `.deb` and `.tar.gz`.

### Housekeeping

```bash
npm run clean        # wipe settings/history/snippets (the app's user-data folder)
npm run clean:dist   # wipe samekodevcpp/
npm run rebuild      # clean:dist, then a full build
```

<br />

## ⌨️ Shortcuts

| Key                | Action               |
| :----------------- | :------------------- |
| `F9`               | Compile              |
| `F10`              | Run                  |
| `F11`              | Compile & Run        |
| `Ctrl + N`         | New file             |
| `Ctrl + O`         | Open file            |
| `Ctrl + S`         | Save file            |
| `Ctrl + Shift + S` | Save As              |
| `Ctrl + J`         | Toggle Panel         |
| `Ctrl + \`         | Split Editor         |
| `Ctrl + Shift + A` | Auto Format (AStyle) |
| `Ctrl + Alt + S`   | Toggle Auto-Save     |
| `Ctrl + Shift + P` | Command Palette      |

### While debugging

Click the left gutter to set a breakpoint, then press `F5`. `F10` and `F11` switch to stepping for
as long as the session is live, and go back to Run / Compile & Run once it ends.

| Key               | Action                                        |
| :---------------- | :-------------------------------------------- |
| `F5`              | Start debugging · Continue                    |
| `F10`             | Step over                                     |
| `F11`             | Step into                                     |
| `Shift + F11`     | Step out                                      |
| `Shift + F5`      | Stop debugging                                |
| `Esc`             | Stop an Auto dry run · leave the step history |
| `Alt` + gutter    | Conditional breakpoint                        |
| `Ctrl` + gutter   | Enable / disable a breakpoint                 |
| Right-click a line | Run to Cursor                                |

<br />

## 🤝 Contributing

**💖 Contributors**

- **Yunchan** (Special thanks for designing the logo!)
- **aiko-chan-ai** (Fixed G++ spawn issue on some machines)

**📝 Want to contribute?**

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a PR.

<br />

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

<br />

---

<div align="center">
  <p>Made with 💙 and 🐟 by <a href="https://github.com/QuangquyNguyenvo"><strong>QuangquyNguyenvo</strong></a></p>
  <p><i>"Have a bubbly day!"</i></p>
  <br />
  <p>
    <a href="https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues">Report Bug</a> •
    <a href="https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues">Request Feature</a>
  </p>
</div>

<img src="src/assets/docs/readme-footer.svg" width="100%" />

---

<div align="center">
  <sub><strong>Keywords</strong>: C++ IDE • portable C++ compiler • Dev-C++ alternative • competitive programming IDE • beginner-friendly IDE • lightweight IDE • Windows C++ IDE • GCC compiler • Monaco Editor • Electron IDE • code editor • student IDE • educational software • free C++ IDE • C++11 • C++14 • C++17 • C++20 • C++23 • syntax highlighting • auto-completion • Codeforces • AtCoder • LeetCode • programming tools • MinGW • code runner • AStyle formatter</sub>
</div>

