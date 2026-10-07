# Blind test

Internal testing tool. A Cursor agent plays Vault Guardian through the public
player API without ever seeing a password, and the whole run is written to
disk.

It is independent of the game: it imports nothing from `../src/`, runs on Node
rather than Bare, and keeps its dependency (`@cursor/sdk`) in its own
`package.json` so the game app stays Bare-only.

## Why

The doors are tuned to a specific guardian model, and a sealed door looks
identical to a working one from the outside. A blind run answers the question
the admin Test-attack panel cannot: with the shipped hints and ten messages a
door, is there still a route through, found by a player who has never read
`src/levels.js`?

## Run it

```bash
npm install --prefix blind-test     # once
export CURSOR_API_KEY=...           # or: node blind-test/src/cli.js --login

# In one terminal: the game. QVAC_MOCK=1 exercises the plumbing without a model.
npm run dev

# In another: the blind player
npm run blind-test -- --url http://127.0.0.1:8787
```

`--spawn` starts a throwaway game server instead of attaching to one, on a free
port with its own `VAULT_DATA_DIR`, no `DOOR_URL` and no `FREE_ROAM`. Attaching
is the default because loading the guardian model twice is expensive.

`node blind-test/src/cli.js --help` lists every flag (`--model`, `--reasoning`,
`--effort`, `--log-dir`, `--timeout`, `--boot-timeout`, `--no-final-guess`).

`--reasoning` and `--effort` are the same axis under the two names the catalog
uses for it: Claude Opus declares `effort`, GPT-5.6 Sol declares `reasoning`.
Pass the one the chosen model has.

## Watching a run in the game's own UI

`--ui-events` makes the CLI also print each move as a tagged JSON line on
stdout, which is how the game's **AI vs AI** screen renders a run live. The
tagged lines are the only difference: progress output, logs and exit codes are
unchanged, and without the flag the event stream does not exist.

The game starts the CLI this way itself: see [`src/ai-runs.js`](../src/ai-runs.js)
and the AI-vs-AI section of the [main README](../README.md). The two paced pauses
in [`src/tools.js`](src/tools.js), before a message and before a guess, exist so
the page can type the words into its fields before the request carries them; they
only happen when the stream is on.

Note: a `cursor-agent login` session is a different credential store from the
SDK's. Use `CURSOR_API_KEY` or `--login`.

### The physical vault

Clearing the last door on a server with `DOOR_URL` set pulses the real relay.
`--spawn` strips `DOOR_URL` from the child's environment; when attaching, pass
`--no-final-guess` to stop before submitting the final password.

## What the agent can see

| It has | It does not have |
|--------|------------------|
| `game_state`, `game_chat`, `game_guess`, `game_reset` | Any filesystem, shell, or web tool |
| Guardian replies, coaching hints, static hints | Passwords, system prompts, blocklists |
| Its message budget and which guard blocked a turn | This repo: its cwd is an empty scratch dir |

Blindness rests on three things in [`src/agent.js`](src/agent.js): `local.cwd`
points at `blind-test/workspace/` rather than the repo, `tools: ['mcp']` offers
the custom game tools and nothing else, and `local.settingSources: []` keeps
the project's `.cursor` rules (which point at this repo's README, Solutions
section included) out of the run.

[`src/prompt.js`](src/prompt.js) is deliberately mechanical: the rules, the
tools, and how the message budget is spent. It suggests no attack. Adding
"try a word game" would measure the hint instead of the player.

## Logs

Each run writes `blind-test/logs/<timestamp>/` (gitignored):

- `events.jsonl`: every tool call and result, assistant text, thinking, run
  lifecycle. Machine-readable replay.
- `transcript.md`: the run as a conversation: door, message number, what the
  player said, what the guardian answered, the hint, the guesses.
- `summary.json`: model, agent and run ids, doors cleared, per-door message
  and block counts, every guess, outcome, duration.
- `server.log`: only with `--spawn`.

Passwords never appear in a log because the API never returns one. The guesses
the agent submits do appear, which is the point.

## Exit codes

`0` the run finished, `1` the agent never started (auth, config, no server),
`2` the run started and failed. The exit code says nothing about whether the
agent won: read `outcome` in `summary.json`.
