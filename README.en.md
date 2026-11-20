# Electron Game Bridge

[简体中文](README.md) · **English**

Manage and launch Electron games distributed for Windows on macOS. Add a game's complete distribution folder and the launcher detects the required Electron version, then uses a matching macOS build to run the game's original entry point. The game package stays intact.

## Supported games

Keep the EXE and resources from the Windows distribution together. The folder you import should contain `resources/app.asar` or `resources/app`. If you only have an EXE, obtain the accessible application resources first. Games that depend on Windows-only components or incompatible native modules may fail to launch.

## Quick start

1. Before opening the launcher for the first time, download and unpack an `Electron.app` build for your Mac. No `npm install` is required. [Official Electron releases](https://github.com/electron/electron/releases)
2. Run the following command from the project folder, replacing the example path with your own. You can also put `Electron.app` in the project's `runtime/` folder and double-click `启动游戏库.command`.

   ```sh
   LAUNCHER_ELECTRON='/path/to/Electron.app' ./启动游戏库.command
   ```

3. Click **添加游戏** (Add game), enter a name, and select the complete distribution folder. Leave the entry point set to `.` to detect the packaged resources automatically. Once the required version is identified, register a local Electron build or click **从官网安装匹配版本** (Install matching version).
4. Click **保存设置** (Save settings), select the game in the library, then click **启动游戏** (Launch game).

## Screenshots

The screenshots show the launcher’s Chinese interface with synthetic test games and saves. The library starts empty.

**Game library.** Switch between local games, see the matching Electron version, installation folder, and save compatibility status, or open settings and launch a game.

![Game library showing two demo games and the selected game's runtime, launch, and settings buttons](docs/images/game-library.png)

**Electron runtimes.** See registered Electron builds and the games using them, or detect and register an existing `Electron.app`. Official downloads show progress and can be canceled. The launcher verifies downloads with SHA-256 and probes the executable before registering it. Games can share a runtime when the version and architecture match.

![Electron management window showing a registered runtime, its associated games, and the local registration form](docs/images/electron-runtimes.png)

**Save compatibility.** For recognized Tyrano 500/520 file-save implementations, inspect saves in the game folder and `resources`, then choose the location to use at the next launch. The launcher backs up the selected saves before enabling or changing the location. Progress in each folder stays separate.

![Game settings showing two Tyrano save folders, the current path, and the path that will take effect after saving](docs/images/save-location.png)

## Local data and documentation

The launcher stores game settings and its default per-game data directories under `.launcher/`. If the configuration is damaged, use **配置恢复** (Configuration recovery) to restore the last valid library configuration. See `logs/launcher.log` and `logs/games/` for launch diagnostics.

[Runtime management](specs/003-runtime-management/spec.md) · [Save compatibility limits](specs/002-engine-save-compat/validation.md) · [Save recovery steps](specs/002-engine-save-compat/quickstart.md#7-人工恢复与回退) (Chinese)
