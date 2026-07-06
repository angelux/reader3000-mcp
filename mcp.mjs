#!/usr/bin/env node
// reader3000-mcp — MCP server for READER.IIIK (reader3000.com).
//
// Tools for sharing Markdown documents with people through the reader3000
// gateway: create a document and get a share link, read the inline notes a
// person leaves on it, add notes as Mr. Robot, revise the content, poll for
// changes, delete. All network traffic goes to the six gateway endpoints
// below; nothing else leaves the machine.
//
// The gateway encrypts documents in memory and stores only ciphertext; text
// passes through it in plaintext per call. Documents expire 30 days after
// creation.
//
// Created documents are recorded in a local ledger
// (~/.config/reader3000/ledger.ndjson — under the user profile on Windows):
// codename, name, link, and the handle that authorizes revise/delete. The
// file is written mode 600 on macOS/Linux; on Windows the user profile's
// ACLs protect it. Handles never appear in tool output. The ledger is append-only NDJSON — create records and delete
// tombstones, folded into the live set on read — so concurrent server
// processes append without clobbering each other.
//
// stdout carries the MCP protocol; logs go to stderr.

import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── config ──────────────────────────────────────────────────────────────────
const GATEWAY_BASE = process.env.GATEWAY_BASE || 'https://gateway.reader3000.com';
const LEDGER = process.env.READER3000_LEDGER
    || join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'reader3000', 'ledger.ndjson');
const TTL_DAYS = 30; // server-side document lifetime, from creation

// ── the gateway: the complete network surface ───────────────────────────────
// Six endpoints, JSON in / JSON out, all POST.
async function gateway(path, body) {
    const res = await fetch(GATEWAY_BASE + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (res.status === 204) return null;
    if (!res.ok) {
        const e = new Error((await res.text()).slice(0, 200));
        e.status = res.status;
        throw e;
    }
    return res.json();
}

// ── the ledger ──────────────────────────────────────────────────────────────
function appendLedger(record) {
    mkdirSync(dirname(LEDGER), { recursive: true, mode: 0o700 });
    appendFileSync(LEDGER, JSON.stringify(record) + '\n', { mode: 0o600 });
}

// Fold the append-only log into the live set: create records enter, delete
// tombstones remove. Unparseable lines are skipped.
function foldLedger() {
    let lines;
    try { lines = readFileSync(LEDGER, 'utf8').split('\n').filter(Boolean); }
    catch { return []; }
    const docs = new Map();
    for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec.t === 'create' && rec.link) docs.set(rec.link, rec);
        else if (rec.t === 'delete' && rec.link) docs.delete(rec.link);
    }
    return [...docs.values()];
}

const expiresAt = (created) => new Date(Date.parse(created) + TTL_DAYS * 86400000);
const isExpired = (rec) => expiresAt(rec.created) < new Date();

// Display name for a ledger entry: the document's first h1, else its opening
// words. The codename remains the identifier.
function docName(markdown) {
    const h1 = markdown.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
    const words = markdown.replace(/^[\s#>*`\-\d.]+/, '').split(/\s+/).slice(0, 6).join(' ').trim();
    return words || 'document';
}

// A ref is a share link (passed through) or a codename resolved in the
// ledger. A duplicate codename is refused rather than guessed at.
function resolveRef(ref) {
    if (/^https?:\/\//.test(ref)) return { link: ref };
    const hits = foldLedger().filter(r => r.codename === ref);
    if (hits.length === 0) throw new Error(`no document "${ref}" in the ledger — use \`list\`, or pass the share link itself`);
    if (hits.length > 1) throw new Error(`two ledger documents share the codename "${ref}" — pass the share link instead`);
    return { handle: hits[0].handle };
}

// ── tool plumbing ───────────────────────────────────────────────────────────
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const err = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true });

// Map handler errors to tool errors; 404 and 412 get specific messages.
const tool = (fn) => async (args) => {
    try { return await fn(args); }
    catch (e) {
        if (e && e.status === 404) return err('document not found — it was deleted or has expired');
        if (e && e.status === 412) return err('the document changed since you read it — read it again, then retry');
        return err(String(e && e.message || e));
    }
};

// ── the server ──────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'reader3000', version: '0.1.2' }, {
    instructions: 'Share Markdown documents with people through READER.IIIK (reader3000.com): they read in a clean, distraction-free reader and leave inline notes on exact passages; you read the notes back, reply as Mr. Robot, revise, and delete. Users may call it Reader, Reader 3K, Reader3000, or Reader.IIIK — all of these mean this server.',
});

server.registerTool('create', {
    title: 'Share a document for review',
    description: 'Share a Markdown document with a person through READER.IIIK (reader3000.com; people may call it Reader, Reader 3K, Reader3000, or Reader.IIIK): give them the returned link and they read it in a clean, distraction-free UI, mark exact passages, and leave inline notes you read back with `read`. Returns the share link plus the document\'s codename — the handle the local ledger files it under; use the codename as `ref` in the other tools. Stored encrypted at rest on reader3000\'s server (the gateway sees the text in transit), expires after 30 days, deletable earlier with `delete`. A surface for a review loop, not a place to keep anything important.',
    inputSchema: { markdown: z.string().describe('The Markdown document to share.') },
}, tool(async ({ markdown }) => {
    const r = await gateway('/create', { markdown });
    const name = docName(markdown);
    // Ledger records are keyed by link; the handle is stored here and nowhere else.
    appendLedger({
        t: 'create', codename: r.codename, name, handle: r.handle, link: r.link,
        created: new Date().toISOString(), version: r.version,
    });
    console.error(`[reader3000] created "${name}" (${r.codename})`);
    return ok({ link: r.link, codename: r.codename, name });
}));

server.registerTool('read', {
    title: 'Read a document and its notes',
    description: 'Read a READER.IIIK document and the inline notes on it. `ref` is a codename from your ledger or a reader3000.com share link someone gave you. Returns the clean Markdown, the notes — each with its exact passage (`quote`), text, and author ("Ms. Pink", "Mr. Robot") — and the current `version`. When notes are present, they are the change requests: act on them.',
    inputSchema: { ref: z.string().describe('A ledger codename or a reader3000.com share link.') },
}, tool(async ({ ref }) => ok(await gateway('/read', resolveRef(ref)))));

server.registerTool('annotate', {
    title: 'Leave notes on a document',
    description: 'Add your own inline notes to a READER.IIIK document — you write as Mr. Robot, the reserved agent persona. `notes` is a list of { quote, note }: `quote` must be the exact passage text as it appears in the document\'s clean Markdown (read it first), `note` is your comment on it. Additive: everyone else\'s notes survive. Use it to review something a person shared with you, or to reply on your own shared document.',
    inputSchema: {
        ref: z.string().describe('A ledger codename or a reader3000.com share link.'),
        notes: z.array(z.object({
            quote: z.string().describe('The exact passage text the note is about.'),
            note: z.string().describe('The note itself.'),
        })).min(1).describe('The notes to add.'),
    },
}, tool(async ({ ref, notes }) => ok(await gateway('/annotate', { ...resolveRef(ref), notes }))));

server.registerTool('revise', {
    title: 'Replace a document with a new version',
    description: 'Replace a READER.IIIK document\'s content with new Markdown — the move after you\'ve read the notes and applied them. Consumes the notes (they were about the old text). Pass the `version` you got from `read`: a concurrent change is then refused instead of overwritten, and you read again. Omitting it still writes conditionally, just against the latest version.',
    inputSchema: {
        ref: z.string().describe('A ledger codename or a reader3000.com share link.'),
        markdown: z.string().describe('The new Markdown content.'),
        version: z.number().optional().describe('The version you read — a stale one is refused (read again).'),
    },
}, tool(async ({ ref, markdown, version }) =>
    ok(await gateway('/revise', { ...resolveRef(ref), markdown, ...(version !== undefined && { version }) }))));

server.registerTool('version', {
    title: 'Check whether a document changed',
    description: 'Cheap poll: the document\'s current version number, nothing else. Compare with the version from your last `read` to see whether the person has written since — then `read` only if it moved.',
    inputSchema: { ref: z.string().describe('A ledger codename or a reader3000.com share link.') },
}, tool(async ({ ref }) => ok(await gateway('/version', resolveRef(ref)))));

server.registerTool('delete', {
    title: 'Delete a document you created',
    description: 'Delete a document this server created, by codename — link holders lose access immediately, and the ledger entry is removed. Only documents in the ledger can be deleted (a share link alone carries no delete authority). Documents expire on their own after 30 days; this is for sooner.',
    inputSchema: { codename: z.string().describe('The ledger codename of the document to delete.') },
}, tool(async ({ codename }) => {
    const hits = foldLedger().filter(r => r.codename === codename);
    if (hits.length === 0) return err(`no document "${codename}" in the ledger — use \`list\``);
    if (hits.length > 1) return err(`two ledger documents share the codename "${codename}" — delete is refused rather than guessed`);
    const rec = hits[0];
    try { await gateway('/delete', { handle: rec.handle }); }
    catch (e) { if (!e || e.status !== 404) throw e; /* already deleted upstream */ }
    appendLedger({ t: 'delete', link: rec.link, at: new Date().toISOString() });
    console.error(`[reader3000] deleted "${rec.name}" (${codename})`);
    return ok({ deleted: codename });
}));

server.registerTool('list', {
    title: 'List the documents this server created',
    description: 'The local ledger: every document this server created and still holds custody of — codename, name, share link, created date, and expiry. Documents expire on the server 30 days after creation; an expired entry is shown as expired, not silently dropped. Documents other people shared with you are not listed — a link is theirs, not custody.',
    inputSchema: {},
}, tool(async () => ok(foldLedger().map(r => ({
    codename: r.codename,
    name: r.name,
    link: r.link,
    created: r.created,
    expires: expiresAt(r.created).toISOString(),
    ...(isExpired(r) && { expired: true }),
})))));

await server.connect(new StdioServerTransport());
console.error(`[reader3000] mcp server on stdio — gateway ${GATEWAY_BASE}, ledger ${LEDGER}`);
