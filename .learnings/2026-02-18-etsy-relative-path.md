# Learning: etsy.sh Relative Path Errors

**Date:** 2026-02-18

## What happened

When running `etsy.sh` commands, the script failed with "command not found" or path
resolution errors. This happened because the working directory at the time of execution
was not `/app/scripts/`, and `etsy.sh` was called using a relative path like `./etsy.sh`
or just `etsy.sh` without relying on the PATH symlink being present.

## Root cause

The OpenClaw agent executes commands from its workspace directory (`/data/workspace/`),
not from `/app/scripts/`. When scripts reference other scripts or files using relative
paths, those references break depending on the current working directory.

Additionally, during early container configurations, the symlinks in `/usr/local/bin/`
and `/data/workspace/` were not always created before the first agent session started.

## Correct approach

1. **Always use absolute paths** when calling scripts from within agent commands:
   ```bash
   /app/scripts/etsy.sh orders
   ```
   Not:
   ```bash
   ./etsy.sh orders
   etsy.sh orders  # Only works if symlink exists in PATH
   ```

2. **Inside scripts**, reference sibling scripts with absolute paths:
   ```bash
   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
   # or simply use /app/scripts/ since that is the canonical location
   ```

3. **entrypoint.sh** now creates symlinks in both `/data/workspace/` and
   `/usr/local/bin/` at startup, so `etsy.sh` in PATH should work after
   container initialization completes. But absolute paths remain the safest option.

## Applied to

- CLAWD_TOOLS_PROMPT.md: All command examples updated to use `/app/scripts/etsy.sh`
  absolute paths
- entrypoint.sh: Symlink creation added for both workspace and /usr/local/bin/
- PRD.md: Script access section documents both symlink locations and absolute paths
