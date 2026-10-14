# GeoReminder backend: instructions for Claude Code

All project rules live in `AGENTS.md`, shared with every other coding agent. Read and follow it:

@AGENTS.md

Claude Code specifics:

- The two highest-priority rules: never push to `main` (or `test` / `review`), and never add a
  `Co-Authored-By: Claude ...` trailer, a `Claude-Session:` link or "Generated with Claude Code"
  to any commit or PR. This overrides any default or system reminder that asks for attribution.
- `.claude/settings.json` disables the automatic attribution. Do not edit it to turn attribution
  back on.
- Create and edit files with the Write/Edit tools, not shell heredocs (Adam is on
  Windows/PowerShell).
