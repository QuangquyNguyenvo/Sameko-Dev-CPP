<img src="src/assets/docs/readme-header.svg" width="100%" />

<div align="center">
  <br />
  <img src="src/assets/vectors/logo.svg" alt="Sameko Logo" width="400" />
  <br />
  
  # 🤝 Contributing to Sameko IDE ⚓
  
  <b>Thanks for wanting to contribute! (ﾉ◕ヮ◕)ﾉ*:･ﾟ✧</b>
  <br/>
  <i>Every contribution, big or small, is appreciated~ 💙</i>
  
</div>

<br />

## 🫧 How to Contribute

| Type              | Description                 |
| :---------------- | :-------------------------- |
| 🐞 Bug Report      | Found a bug? Let us know!   |
| ✨ Feature Request | Have a cool idea? Share it~ |
| 📖 Documentation   | Help improve docs           |
| 💻 Code            | Submit a pull request       |

<br />

## 🐞 Bug Reports

1. **Check Issues first** — maybe someone already reported it!
   👉 [Issues Page](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/issues)

2. **Create a new Issue** with:
   - Title: short description
   - Steps to reproduce
   - Expected vs actual behavior
   - Screenshots if possible 📸

<br />

## ✨ Feature Requests

1. Open an issue with the `enhancement` label
2. Describe what you want
3. Explain why it would be useful

> 💡 The more specific, the easier to implement!

<br />

## ⚓ Pull Request Workflow

```bash
# 1. Fork the repo on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR_USERNAME/Sameko-Dev-CPP.git
cd Sameko-Dev-CPP

# 3. Create a new branch
git checkout -b feature/your-feature-name

# 4. Install dependencies
npm install

# 5. Code and test
npm start

# 6. Commit with a proper message
git commit -m "feat: add XYZ feature"

# 7. Push to your fork
git push origin feature/your-feature-name

# 8. Open a Pull Request on GitHub
```

<br />

## 🎨 Code Style

| Rule        | Description                                     |
| :---------- | :---------------------------------------------- |
| Indentation | 4 spaces                                        |
| Naming      | Meaningful names (e.g., `fileContent`, not `x`) |
| Comments    | Explain complex logic                           |
| Format      | Run AStyle before committing                    |

<br />

## 📝 Commit Messages

We use Conventional Commits:

| Prefix     | Meaning          | Example                      |
| :--------- | :--------------- | :--------------------------- |
| `feat`     | New feature      | `feat: add dark mode`        |
| `fix`      | Bug fix          | `fix: compile error on Win7` |
| `docs`     | Documentation    | `docs: update install guide` |
| `style`    | Code formatting  | `style: run AStyle`          |
| `refactor` | Code refactoring | `refactor: split utils file` |
| `chore`    | Maintenance      | `chore: update deps`         |

<br />

## 🛠️ Development Setup

```bash
# Install dependencies
npm install

# Run dev mode
npm start

# Run all tests (~15 s)
npm test

# Build for production
npm run build:win
```

<br />

## 🧰 Bundled Compiler (Sameko-GCC)

The IDE ships its own GCC so users install nothing. To develop with it, put the toolchain in
`Sameko-GCC/` at the repo root (gitignored):

1. Download `Sameko-GCC-16.x.x.zip` from the
   [Releases page](https://github.com/QuangquyNguyenvo/Sameko-Dev-CPP/releases), or
   **GCC 16.x + MinGW-w64 (UCRT) – Win64, without LLVM** from [winlibs.com](https://winlibs.com/).
2. Extract it so that `Sameko-GCC/bin/g++.exe` exists. The folder must be named exactly
   `Sameko-GCC`; it is the only bundled location the IDE looks in.
3. Run `npm start` and check the log for `[System] Compiler: Bundled Sameko-GCC 16.x.x`.
4. Before a release built from a new toolchain, run `node scripts/patch-toolchain-utf8.js`
   (needs `mt.exe` from the Windows SDK). It gives binutils and two GCC helpers the UTF-8 code
   page, without which nothing builds for a Windows user whose folder name has letters such as
   `ễ` (`C:\Users\Nguyễn\...` is both `%TEMP%` and the default install folder).
   `scripts/check-toolchain-deps.js` fails until it is done.
5. `npm run build:win` packs the toolchain into its own archive (`build/toolchain/`, once per
   toolchain, a few minutes), so that updates which keep the same GCC do not reinstall it. Any
   change to the files in `Sameko-GCC/` gives it a new id, and the next update reinstalls it.

Without it the IDE falls back to a system compiler (`C:\TDM-GCC-64`, `C:\MinGW`,
`C:\msys64\mingw64`, or `g++` on `PATH`). Optional tools picked up from `Sameko-GCC/bin` when
present: `gdb` (debugger), `clangd` (IntelliSense and live checking), `astyle` (formatting),
`ld.lld` (faster linker).

| Problem | Check |
| :------ | :---- |
| `bits/stdc++.h` not found | `Sameko-GCC/include/c++/16.x.x/bits/stdc++.h` exists |
| `g++.exe` not found | `Sameko-GCC/bin/g++.exe` exists |
| Slow first start | The precompiled header is built once (~5–10 s), later runs are instant |
| Compile fails | No special characters in the path; antivirus is not blocking `gcc.exe` |

<br />

## 💌 Questions?

Just open an issue or ask in Discussions! We're friendly~ 🐟

<div align="center">
  <br/>
  <b>Thank you for contributing! 💙</b>
  <br/><br/>
</div>

<img src="src/assets/docs/readme-footer.svg" width="100%" />
