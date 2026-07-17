# Hook capture reliability

Claude Code does not reliably wait for `SessionEnd` hooks during `/exit` or terminal close. It can tear down the hook process tree within roughly one second. `/clear` often hides the problem because Claude Code remains alive.

The integration therefore uses a small synchronous shim. It reads stdin, checks the transcript entrypoint, writes a temporary input file, spawns a detached capture worker, and exits. The worker performs parsing, pricing, and shard writing after the host process is gone.

## Diagnostic signatures

The hook log is `~/.agent-usage-stat/hook.log`.

| Pattern | Meaning |
|---|---|
| `shim spawned worker` followed by `invoke` and `done` | Healthy |
| `shim spawned worker` without `invoke` | Worker was killed before startup |
| No `shim` line | Wrapper or hook never started |
| `shim skip: non-interactive entrypoint=sdk-cli` | Intentional automation skip |
| Worker enters manual mode after a hook | Temporary hook input was missing or invalid |

## Checks

```bash
time (printf '' | node bin/agent-usage-stat.js capture --detach)
time (printf '' | bash bin/run-hook.sh capture --detach --quiet)
time node bin/agent-usage-stat.js --version
```

Manual checks validate startup and wiring. Only a real Claude Code `/exit` validates survival during host teardown.

## Invariants

1. `src/cli.ts`, `src/commands/detach-shim.ts`, and `src/utils/hook-log.ts` may import only lightweight modules on the shim path.
2. The shim does only stdin read, entrypoint gate, temporary file write, detached spawn, and exit.
3. Do not mark the Claude `SessionEnd` hook async. The host must wait long enough for the shim to spawn its worker.
4. Keep Node resolution in `bin/run-hook.sh`. Never write an absolute Node executable into host settings.
5. Read no more than 128 KB from a transcript for the entrypoint gate.
6. Use valid JSON paths in synthetic hook tests. Raw Windows backslashes are invalid JSON escapes.
7. Validate changes with a real `/exit`, not only `/clear`.
8. Keep `bin/run-hook.sh` executable in Git.

The `AGENT_USAGE_STAT_ALL_SESSIONS=1` environment variable disables the Claude automation gate when SDK session capture is intentional.
