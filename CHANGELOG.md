# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-08

### Added

- Initial public release
- Paprika cloud sync API client
- CLI commands:
  - `auth` - Interactive authentication
  - `logout` - Clear stored credentials
  - `whoami` - Show current user
  - `recipes` - List all recipes (with category filter)
  - `recipe <id>` - Get recipe by UID or name
  - `search <query>` - Search recipes
  - `meals` - Show meal plan (with date filter)
  - `groceries` - Show grocery list
  - `categories` - List recipe categories
- JSON output support (`--json` flag)
- Color control (`--no-color` flag, `NO_COLOR` env var)
- Environment variable auth (`PAPRIKA_EMAIL`, `PAPRIKA_PASSWORD`)
- Proper exit codes (0=success, 1=failure, 2=invalid usage, 3=auth failure)

### Notes

This is the first public release. Requires a Paprika Recipe Manager account with cloud sync.
