# Claudezilla Loop Plugin

Focus loop feature for Claudezilla - enables persistent iterative development.

## Overview

This plugin provides Ralph Wiggum-style focus loops for Claudezilla. It uses Claude Code's Stop hook to intercept session exits and re-inject prompts, allowing Claude to work iteratively on a task.

## How It Works

1. You start a loop via `firefox_start_loop({ prompt: "...", maxIterations: 20 })`
2. Claude works on the task and eventually tries to exit
3. This plugin's Stop hook intercepts the exit
4. Hook queries Claudezilla for loop state via Unix socket
5. If loop is active and not complete, hook blocks exit and re-injects the prompt
6. Claude continues working, seeing its previous changes in files
7. Loop ends when max iterations reached (or manually stopped)

## Installation

The plugin is bundled with Claudezilla. To install:

```bash
# From claudezilla directory
ln -s "$(pwd)/plugin" ~/.claude/plugins/claudezilla-loop
```

### Direct URL install (Claude Code 2.1.129+)

Claude Code 2.1.129 added a `--plugin-url` flag that installs a plugin from a
remote `.zip` archive. Once your plugin directory is published as a zip
(e.g. via a GitHub release asset), users can install it without cloning:

```bash
claude --plugin-url https://github.com/boot-industries/claudezilla/releases/download/v0.6.5/claudezilla-loop-0.2.0.zip
```

The plugin manifest (`.claude-plugin/plugin.json`) declares the
`name`, `version`, `homepage`, `bugs`, and `license` fields that Claude Code
reads when registering the plugin.

## Usage

```javascript
// Start a focus loop
firefox_start_loop({
  prompt: "Build a REST API for todos",
  maxIterations: 20,
  completionPromise: "DONE"  // Optional: end loop when Claude outputs <promise>DONE</promise>
})

// Check loop status
firefox_loop_status()
// Returns: { active: true, iteration: 5, maxIterations: 20, ... }

// Stop the loop manually
firefox_stop_loop()
```

## Requirements

- Claudezilla extension running in Firefox
- Claudezilla native host running
- `jq` and `nc` (netcat) available in PATH

## Architecture

```
Claude Code Session
    ↓
Stop Hook (this plugin)
    ↓ (Unix socket query)
Claudezilla Host
    ↓ (in-memory state)
Loop State: { active, iteration, prompt, ... }
```

## Files

- `.claude-plugin/plugin.json` - Plugin metadata
- `hooks/hooks.json` - Hook registration
- `hooks/stop-hook.sh` - Stop hook script

## Safety

- **Max iterations**: Always set a reasonable limit to prevent infinite loops
- **Memory-only state**: Loop resets if Claudezilla host restarts
- **Manual stop**: Use `firefox_stop_loop()` or Ctrl+C to exit immediately

## Version

- **0.2.0** — Claudezilla 0.6.5: session-scoped loops via `CLAUDE_CODE_SESSION_ID`, hardened stop hook (bounded `nc -w` timeouts, JSON validation), marketplace metadata
- **0.1.0** — Initial release with Claudezilla 0.4.7
