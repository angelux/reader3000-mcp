# reader3000-mcp

An MCP server for **READER.IIIK** ([reader3000.com](https://reader3000.com)) —
share a Markdown document with a person, they read it in a clean,
distraction-free reader and leave inline notes on exact passages, and those
notes come back to you as structured change requests. You can leave notes too
(as **Mr. Robot**, the reserved agent persona), revise the document, and
delete it when you're done.

A surface for a review loop, **not a place to keep anything important**.

## Install

`reader3000-mcp` is a standard stdio MCP server. Point any MCP host at
`npx -y reader3000-mcp` — the one command every host wraps. Most hosts read it
as a config-file entry:

```json
{ "mcpServers": { "reader3000": { "command": "npx", "args": ["-y", "reader3000-mcp"] } } }
```

Some spell the same thing as a one-line command:

```
claude mcp add reader3000 --scope user -- npx -y reader3000-mcp   # Claude Code
```

```
codex mcp add reader3000 -- npx -y reader3000-mcp    # Codex
```

The `--scope user` flag installs it for every project. Without it, Claude Code
adds the server to the current directory only. Codex installs for all projects
by default.

Or run it from a checkout: point your host at `node mcp.mjs`.

## Tools

| Tool | What it does |
| --- | --- |
| `create` | Share a Markdown document → `{link, codename, name}`. Hand the link to a person. |
| `read` | The document + its notes (each with passage, text, and author) + version. |
| `annotate` | Add your own notes, as Mr. Robot. Additive — nobody else's notes are touched. |
| `revise` | Replace the content (after applying notes). Conditional: a stale version is refused. |
| `version` | Cheap "has anything changed?" poll. |
| `delete` | Delete a document you created, by codename. |
| `list` | The local ledger: every document this server created and still owns. |

`ref` arguments accept either a **codename** from the ledger (`amber-harbor`)
or a **reader3000.com share link** someone gave you.

## What this server does with your data — the whole truth

- **Network surface:** exactly six HTTPS calls, all to
  `https://gateway.reader3000.com` (`/create /read /annotate /revise /version
  /delete`). Nothing else ever leaves your machine; the code is one file
  (`mcp.mjs`) and greppable in one sitting.
- **The gateway tier, stated honestly:** the gateway encrypts/decrypts **in
  memory and stores nothing**; the storage server holds **only ciphertext**.
  Your text does transit the gateway in plaintext — that is the trade this
  tier makes for you not having to run any crypto. It is a good-effort
  privacy posture, not a vault, and it is why the rule above exists: a review
  surface, not storage.
- **The ledger** (`~/.config/reader3000/ledger.ndjson`; on Windows this
  resolves under your user profile): every document `create` makes is filed
  locally — codename, name, link, and the secret-bearing *handle* that
  authorizes revise/delete — so a document stays yours after the conversation
  that spawned it ends. **That file is the keys**: treat it like an
  unpassphrased SSH key. It is written mode `600` on macOS/Linux; on Windows
  your user profile's ACLs protect it. The handle never appears in any tool
  output; the conversation transcript only ever carries what the human you're
  sharing with would see anyway (the link, the codename).
- **A link is access:** anyone holding a share link can read, annotate, and
  revise that one document (not delete it). Documents expire on the server 30
  days after creation.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `GATEWAY_BASE` | `https://gateway.reader3000.com` | The gateway to talk to (dev override). |
| `READER3000_LEDGER` | `$XDG_CONFIG_HOME/reader3000/ledger.ndjson` | Ledger file path. |

Note: MCP hosts spawn servers with a minimal environment — set overrides in
the host's server config (`env` block), not your shell profile.

## Verifying

`npm install`, then `npm test` — from a checkout or the unpacked npm tarball,
which ships the suite. It drives the real server over stdio against a stub
gateway (no network, no reader3000 account needed) and locks the
secret-hygiene rule: no tool output ever contains a handle.

This repository is published for use and audit; it does not take
contributions.
