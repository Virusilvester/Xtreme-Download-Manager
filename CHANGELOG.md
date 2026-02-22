# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/).

## [3.1] - 2026-02-22

### Added
- Toolbar popup wiring (`status.html`) and persisted “monitoring disabled” state via `chrome.storage.local`.
- Optional Chrome Web Store upload/publish step in the GitHub Release workflow (runs only when required secrets are set).

### Changed
- Release workflow now uses `actions/checkout@v4` and `GITHUB_TOKEN` with `contents: write` permissions.
- Service worker initialization now uses `runtime.onInstalled`/`onStartup` for alarms and context menus (MV3-friendly).

### Fixed
- Missing “download all links” handler (`sendUrlsToXDM`) and safer message handling.
- Alarm period set to a valid interval and request tracking made more robust to avoid leaks.
- Action icon/popup now reflects XDM/monitoring/disabled state more reliably.

## [3.0] - 2026-02-22

### Added
- Initial MV3 extension: service worker (`bg.js`), content script (`contentscript.js`), and popup UI (`status.html` + `popup.js`).
- GitHub Actions workflow to build a Chrome-ready zip and attach it to a GitHub Release on tag pushes (`v*`).

