# SessionEnd Hook Reliability — Engineering Log

> **READ THIS BEFORE "fixing" the SessionEnd hook.** This problem has been
> re-opened repeatedly because each fix addressed a *symptom* while the root
> tension stayed undocumented. If receipts stop appearing (false negatives) or
> appear too often (false positives), you are almost certainly about to repeat
> a cycle that already happened. Read the timeline, run the diagnostics, and
> respect the invariants at the bottom before changing anything.

---

## The root tension (this is the thing that keeps biting)

Claude Code's **SessionEnd hook is fundamentally unreliable on session exit**,
and this is outside our control:

- On `/exit` (and terminal close), Claude Code does **not** reliably wait for
  SessionEnd hooks. It tears down the hook process tree within ~1s and shows
  **"hook is cancelled"**. (Public refs: anthropics/claude-code #41577 async
  SessionEnd killed before completion; #17885 SessionEnd may not fire on
  `/exit`; #32712 Ctrl-C cancels it; thedotmack/claude-mem #1395 — *identical*
  "Hook cancelled on Windows" symptom.)
- On `/clear`, the Claude Code process **stays alive**, so a slow/heavy hook
  completes. **This is why a broken hook often "works on /clear but not
  /exit" — that asymmetry is the signature of this whole class of bug.**

Our entire architecture is a workaround for this: the hook is a **thin shim**
that does almost nothing except `spawn` a **detached background worker**, then
exits. The worker survives Claude Code's teardown and does the slow rendering
off the critical path.

**The reliability of this hinges on ONE thing: the shim must spawn the worker
*before* Claude Code kills the tree (~1s budget).** Anything that slows the
shim's startup — a heavy import, a slow wrapper, a blocking stdin read —
silently breaks it and produces false negatives. The failure is invisible in
code review because the *logic* is correct; only the *timing* regressed.

---

## Diagnostic guide (do this first, every time)

The hook's only window is `~/.claude-receipts/hook.log`. Match the signature:

| hook.log pattern | Meaning |
|---|---|
| `shim spawned worker pid=N` **followed by** `invoke pid=N` … `done` | Healthy. Full chain ran. |
| `shim spawned worker pid=N` with **no** matching `invoke pid=N` | **Worker killed before starting** → shim spawned it too late (shim too slow) OR teardown too aggressive. This is the classic false-negative. |
| No `shim …` line at all for a real exit | Hook never started, or was killed during the wrapper/node-resolution phase before the first log write. |
| `shim skip: non-interactive entrypoint=sdk-cli` | Working as intended — headless/SDK session correctly skipped (see false-positive history). |
| Worker logs `manual mode` / `manual session=…` when it should have hook JSON | The shim's temp-file JSON was malformed or unreadable → worker fell back to scanning for the most recent session → **generates a receipt for the WRONG session.** |

Measure shim startup (must be well under ~1s; target ≤ ~0.6s through the wrapper):

```bash
# Shim-only path, empty stdin → exits without spawning a worker, no receipt:
time (printf '' | node bin/claude-receipts.js generate --detach)

# Full real hook command as Claude Code invokes it:
time (printf '' | bash bin/run-hook.sh generate --detach --output html,png,pdf)

# Confirm the heavy graph is NOT on the shim path (this is the trap):
time node -e 'await import("./dist/commands/generate.js")'   # ~1.8s — must stay OFF the shim path
time node bin/claude-receipts.js --version                   # must stay fast (~0.2s)
```

End-to-end wiring test (synthetic transcripts, `--output console` to avoid
browser/Drive side effects — **use forward-slash paths in the JSON; Windows
backslashes are invalid JSON escapes and silently send the worker into
wrong-session manual mode**):

```bash
TMP="${TMPDIR:-/tmp}"; CLI="$TMP/cr-test-cli.jsonl"
{ printf '%s\n' '{"type":"user","entrypoint":"cli","timestamp":"2026-01-01T00:00:00Z","message":{"role":"user","content":"hi there"}}';
  printf '%s\n' '{"type":"assistant","timestamp":"2026-01-01T00:00:05Z","message":{"role":"assistant","model":"claude-opus-4-7","usage":{"input_tokens":10,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}'; } > "$CLI"
printf '{"session_id":"t","transcript_path":"%s","reason":"clear","cwd":"C:/tmp"}' "$(cygpath -m "$CLI" 2>/dev/null || echo "$CLI")" \
  | node bin/claude-receipts.js generate --detach --output console
sleep 3; tail -8 "$HOME/.claude-receipts/hook.log"; rm -f "$CLI"
```

**Manual tests cannot reproduce the teardown-kill** (there's no Claude Code
exiting). They only prove the shim is fast and the wiring is correct. The only
true test of the fix is closing a real interactive session and checking the log.

---

## Timeline of fixes (and what each one broke or exposed)

1. **Original** — Heavy work ran synchronously inside the hook. On `/exit` and
   `/clear`, Claude Code killed the hook mid-render: PNG/PDF lost, sometimes the
   logbook row too. A real $391 receipt went missing.

2. **`--detach` shim** (session `bff74b3c`, ~2026-05-21) — Hook became a shim
   that spawns a detached, `unref`'d worker (`spawn(..., {detached:true,
   stdio:"ignore", windowsHide:true})`). Worker survives teardown and renders in
   the background. **Worked at the time** because the shim was fast enough.

3. **False positives** — Headless SDK / `claude -p` automations fire SessionEnd
   with `reason=other` and were each producing a receipt + browser tab + PNG +
   PDF + logbook row. Fixed with an **entrypoint gate**: read the head (128 KB,
   never the whole file — they can be hundreds of MB) of the transcript and bail
   when `entrypoint` starts with `sdk` (interactive runs report `cli`). Override
   with `CLAUDE_RECEIPTS_ALL_SESSIONS=1`. This logic lives in `detach-shim.ts`.

4. **Portable node resolution** (commits `8012e00`, `cda7607`) — Hook routed
   through `bin/run-hook.sh` so node is resolved at runtime (PATH → WinGet glob →
   nvm) instead of baking a versioned `process.execPath` that breaks on upgrade.
   Necessary, but it added a process layer. *(Suspected as the latency culprit
   during the next debug — it is NOT; the wrapper adds only ~0.2s. Don't waste
   time ripping it out.)*

5. **False negatives — "hook is cancelled"** (2026-05-27, this log's origin) —
   Receipts stopped firing on exit; worked on `/clear`. **Root cause: the shim
   was importing the full renderer module graph (`geoip-lite` 154 MB + `date-fns`
   + the `usb` native addon + chalk/boxen/ora) — ~1.8s of module-load time —
   *before* it could read stdin and spawn the worker.** On `/exit` Claude Code
   killed it mid-import, so the worker was never spawned (log showed
   `shim spawned worker` only on the rare slow-teardown case, never `invoke`).
   The logic was correct; the *startup time* had crept up as the app grew.

   **Fix:** split the shim into `src/commands/detach-shim.ts` importing **only
   Node built-ins + `src/utils/hook-log.ts`**, and made `src/cli.ts` route
   `generate --detach` there via dynamic `import()` while lazy-loading every
   command class. Shim startup: **1.8s → ~0.35s** (~0.6s through the wrapper).
   The worker leg (`generate --input-file`) still loads the full graph — fine,
   it's detached and off the critical path.

---

## The recurring trap, stated plainly

> **Every regression in this saga reduces to: something slowed the shim's path
> to `spawn()`, or made the worker start with bad input.** The code keeps
> looking correct, so reviewers approve it, and the timing failure only shows up
> when a *real* session exits on Windows. If you find yourself "fixing the hook"
> again, first run the diagnostics above and check whether shim startup crept
> back up — that is the most likely culprit, not the logic.

---

## Invariants — do not violate without updating this log

1. **Never add a heavy static import to `src/cli.ts`, `src/commands/detach-shim.ts`,
   or `src/utils/hook-log.ts`.** These three are the only modules the
   `--detach` shim loads. "Heavy" = anything that transitively pulls
   `geoip-lite`, `date-fns`, `usb`/native addons, puppeteer, or the renderer/
   usage/location/weather chain. Keep all command classes lazy-imported in
   `cli.ts`.
2. **The shim does the minimum and exits:** read stdin → SDK-skip check → write
   temp file → `spawn` detached worker → exit. No config load, no network, no
   rendering. All of that is the worker's job.
3. **Do NOT add `async: true` to the SessionEnd hook in settings.json.** It tells
   Claude Code not to wait, so it exits *immediately* and may kill the shim
   before it spawns the worker. We *want* Claude Code to wait the ~0.6s for the
   fast shim — that synchronous wait is what guarantees the worker gets spawned.
4. **Keep node resolution via `bin/run-hook.sh`.** Do not bake `process.execPath`
   into settings.json (versioned WinGet path breaks on node upgrade). The wrapper
   is cheap (~0.2s); it is not the latency problem.
5. **The transcript head read stays ≤128 KB.** Transcripts can be hundreds of MB.
6. **Hook JSON paths must be valid JSON.** When constructing test input, use
   forward slashes; never embed raw Windows backslash paths (invalid escapes →
   worker falls into wrong-session manual mode).
7. **Validate on a real `/exit`, not just `/clear`.** `/clear` masks this entire
   bug class because the process stays alive.

---

*Last updated: 2026-05-27 — false-negative ("hook is cancelled") root-caused to
heavy shim imports; shim split into `detach-shim.ts` + lazy `cli.ts` imports.*
