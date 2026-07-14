# Agent Usage Stat

See how your coding agents spend tokens, time, and money.

Agent Usage Stat turns local Claude Code and Codex session history into one private analytics portal. Compare models, projects, machines, token composition, cache efficiency, and API-equivalent cost without sending your data anywhere.

![Agent Usage Stat portal](screenshot.png)

## Start

```bash
npm install -g agent-usage-stat
agent-usage-stat setup
agent-usage-stat
```

`setup` connects Claude Code and Codex. Running `agent-usage-stat` opens the portal at `http://127.0.0.1:4179`.

## What the portal shows

- Spend and token trends over time
- Model and provider mix
- Cache read and write efficiency
- Project, machine, and session comparisons
- Searchable session-level detail

Costs are API-equivalent list-price estimates. They do not represent the marginal cost of a ChatGPT or Claude subscription.

## Local by design

Session metadata is read from the tools' local transcripts and normalized into one JSON shard per session. The portal is served only on localhost, and all aggregation happens on your machine.

To combine several machines, point them at the same synced directory:

```bash
agent-usage-stat config --set dataRoot="<shared-directory>/agent-usage-stat"
```

## Development

```bash
npm install
npm install --prefix portal
npm test
npm run build:portal
node bin/agent-usage-stat.js portal
```

Node.js 20 or newer is required. Licensed under MIT.
