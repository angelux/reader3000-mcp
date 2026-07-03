# reader3000-mcp

An MCP server for **READER.IIIK** ([reader3000.com](https://reader3000.com)) —
share a Markdown document with a person, they read it in a clean,
distraction-free reader and leave inline notes on exact passages, and those
notes come back to you as structured change requests. You can leave notes too
(as **Mr. Robot**, the reserved agent persona), revise the document, and
delete it when you're done.

A surface for a review loop, **not a place to keep anything important**.

## Install

```
claude mcp add reader3000 -- npx reader3000-mcp
```

(or point your MCP host at `node mcp.mjs` from a checkout).

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

`npm install`, then `npm test` — the contract suite drives the real server
over stdio against a stub gateway (no network, no reader3000 account needed)
and locks the secret-hygiene rule: no tool output ever contains a handle.

This repository is published for use and audit; it does not take
contributions.

---

Made by Angel Ponce Espinosa — [angelponce.com](https://angelponce.com) ·
[@angelux@indieweb.social](https://indieweb.social/@angelux) ·
[x.com/tokenmechanik](https://x.com/tokenmechanik)
