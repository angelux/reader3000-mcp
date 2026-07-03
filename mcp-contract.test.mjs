// The MCP contract suite. Drives the real server over stdio with the SDK's own
// client, against a stub gateway (node:http, this file) — no network and no
// reader3000 account needed. Covers:
//   - the seven tools exist and answer;
//   - `create` returns only {link, codename, name}; the handle never appears
//     in any tool output;
//   - ledger behavior: create writes it, list folds it, delete tombstones it,
//     expired entries are listed and marked expired;
//   - ref resolution: a codename becomes the ledger's handle, a link passes
//     through, an unknown codename is an error;
//   - revise threads the caller's version; 404/412 map to specific messages.
// Run: npm test
import { createServer } from 'node:http';
import { mkdtempSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let pass = 0, fail = 0;
const ck = (name, okv, detail) => okv ? (pass++, console.log('PASS  ' + name)) : (fail++, console.log('FAIL  ' + name + (detail ? '\n      ' + detail : '')));

// ── the stub gateway: canned answers, every request recorded ────────────────
const HANDLE = 'STUBSECRETHANDLE_never_in_output';
const LINK = 'https://reader3000.com/d/stub1#at=stubtoken&k=stubkey';
const seen = [];
let minted = 0; // each create mints a distinct doc, like the real gateway
const stub = createServer(async (req, res) => {
    const body = JSON.parse(await new Promise(r => { let b = ''; req.on('data', c => b += c); req.on('end', () => r(b)); }));
    seen.push({ path: req.url, body });
    const reply = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/create') {
        minted++;
        return reply(201, minted === 1
            ? { handle: HANDLE, link: LINK, version: 1, codename: 'amber-harbor' }
            : { handle: 'H' + minted, link: `https://reader3000.com/d/stub${minted}#at=t&k=k`, version: 1, codename: 'olive-mesa' });
    }
    if (req.url === '/read') return reply(200, { clean: '# Stub\n', notes: [{ quote: 'Stub', note: 'hi', author: 'Ms. Pink', orphan: false }], version: 2 });
    if (req.url === '/annotate') return reply(200, { version: 3 });
    if (req.url === '/revise') return body.version === 1 ? reply(412, { version: 3 }) : reply(200, { version: 4 });
    if (req.url === '/version') return reply(200, { version: 4 });
    if (req.url === '/delete') { res.writeHead(204); return res.end(); }
    reply(404, {});
});
await new Promise(r => stub.listen(0, '127.0.0.1', r));
const GATEWAY_BASE = `http://127.0.0.1:${stub.address().port}`;

// ── the real server, spawned over stdio with an isolated ledger ─────────────
const ledgerDir = mkdtempSync(join(tmpdir(), 'r3k-mcp-'));
const LEDGER = join(ledgerDir, 'ledger.ndjson');
const client = new Client({ name: 'contract', version: '0.0.0' });
await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [new URL('./mcp.mjs', import.meta.url).pathname],
    env: { ...process.env, GATEWAY_BASE, READER3000_LEDGER: LEDGER },
}));

const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content.map(c => c.text).join('\n'), isError: !!r.isError };
};
const outputs = [];
const callT = async (name, args) => { const r = await call(name, args); outputs.push(r.text); return r; };

// 1 · the tool surface
const tools = (await client.listTools()).tools.map(t => t.name).sort();
ck('seven tools exist', JSON.stringify(tools) === JSON.stringify(['annotate', 'create', 'delete', 'list', 'read', 'revise', 'version']), tools.join(','));

// 2 · create: link + codename + name in the output, handle in the ledger only
let r = await callT('create', { markdown: '# My Plan\n\nSome body text here.\n' });
let created = JSON.parse(r.text);
ck('create returns the link', created.link === LINK);
ck('create returns the codename', created.codename === 'amber-harbor');
ck('create names the doc by its h1 (the naming ladder)', created.name === 'My Plan');
ck('create returns nothing else (no handle field)', JSON.stringify(Object.keys(created).sort()) === JSON.stringify(['codename', 'link', 'name']));
ck('the ledger file holds the handle', readFileSync(LEDGER, 'utf8').includes(HANDLE));
const posix = process.platform !== 'win32';
ck('the ledger file is chmod 600 (POSIX; Windows relies on profile ACLs)', !posix || (statSync(LEDGER).mode & 0o777) === 0o600);

// 3 · name ladder: no h1 → opening words
r = await callT('create', { markdown: 'plain words open this document, no heading at all\n' });
ck('no h1 → named by its opening words', JSON.parse(r.text).name === 'plain words open this document, no');

// 4 · list: the fold, live entries
r = await callT('list', {});
let listed = JSON.parse(r.text);
ck('list shows both live documents', listed.length === 2);
ck('list entries carry codename/name/link/created/expires', listed.every(e => e.codename && e.name && e.link && e.created && e.expires));
ck('a live entry is not marked expired', listed.every(e => !e.expired));

// 5 · refs resolve
await callT('read', { ref: 'amber-harbor' });
ck('read by codename sends the ledger handle to the gateway', seen.at(-1).path === '/read' && seen.at(-1).body.handle === HANDLE);
await callT('read', { ref: 'https://reader3000.com/d/other#at=x&k=y' });
ck('read by link passes the link through', seen.at(-1).body.link === 'https://reader3000.com/d/other#at=x&k=y');
r = await callT('read', { ref: 'no-such-codename' });
ck('an unknown codename is a typed refusal naming `list`', r.isError && /list/.test(r.text));

// 6 · annotate and revise thread their arguments
await callT('annotate', { ref: 'amber-harbor', notes: [{ quote: 'Stub', note: 'a robot note' }] });
ck('annotate sends the notes', seen.at(-1).path === '/annotate' && seen.at(-1).body.notes[0].note === 'a robot note');
r = await callT('revise', { ref: 'amber-harbor', markdown: '# v2\n', version: 1 });
ck('a stale revise surfaces the honest sentence', r.isError && /changed since you read it/.test(r.text));
r = await callT('revise', { ref: 'amber-harbor', markdown: '# v2\n', version: 3 });
ck('a current revise succeeds', !r.isError && JSON.parse(r.text).version === 4);
r = await callT('version', { ref: 'amber-harbor' });
ck('version polls', !r.isError && JSON.parse(r.text).version === 4);

// 7 · delete: gateway call + tombstone; list no longer shows it
r = await callT('delete', { codename: 'amber-harbor' });
ck('delete answers with the codename', !r.isError && JSON.parse(r.text).deleted === 'amber-harbor');
ck('delete sent the handle to the gateway', seen.at(-1).path === '/delete' && seen.at(-1).body.handle === HANDLE);
r = await callT('list', {});
ck('after delete, list folds the tombstone away', JSON.parse(r.text).length === 1);
r = await callT('delete', { codename: 'amber-harbor' });
ck('deleting it again is a typed refusal', r.isError);

// 8 · an expired entry is listed and marked expired
appendFileSync(LEDGER, JSON.stringify({
    t: 'create', codename: 'old-ridge', name: 'old doc', handle: 'H2', link: 'https://reader3000.com/d/old#at=a&k=b',
    created: new Date(Date.now() - 40 * 86400000).toISOString(), version: 1,
}) + '\n');
r = await callT('list', {});
const old = JSON.parse(r.text).find(e => e.codename === 'old-ridge');
ck('an expired entry is listed AND marked expired', !!old && old.expired === true);

// 9 · an unparseable ledger line is skipped
appendFileSync(LEDGER, '{"t":"create","codename":"torn\n');
r = await callT('list', {});
ck('a torn ledger line is skipped, the fold survives', !r.isError && JSON.parse(r.text).length === 2);

// 10 · no tool output contained a secret
ck('no tool output ever contained the handle', outputs.every(t => !t.includes(HANDLE)));
ck('no tool output ever contained an ownerSecret-looking field', outputs.every(t => !/ownerSecret/.test(t)));

// 11 · invalid input is rejected by schema validation
r = await client.callTool({ name: 'create', arguments: { markdown: 42 } }).then(x => x, e => ({ isError: true }));
ck('a non-string markdown is refused', !!(r.isError));

await client.close();
stub.close();
console.log('\n' + pass + '/' + (pass + fail) + ' mcp-contract checks passed' + (fail ? ' — ' + fail + ' FAILED' : ''));
process.exit(fail ? 1 : 0);
