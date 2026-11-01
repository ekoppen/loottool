// Draait met: npm test. Gebruikt een nep-Apenkaas (zelfde API-vorm als docs/app-aansluiten.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { createAssignments } = require('./assign');

// --- nep-Apenkaas ---
const docs = {}; // collectionId -> Map(id -> doc)
const UNIQUE = { kliks: ['recoveryUrl', 'naam'], deelnemers: ['eventUrl', 'naamLower'] };

function fakeCreate(coll, data, id = crypto.randomUUID()) {
    const rows = (docs[coll] ||= new Map());
    const rule = UNIQUE[coll];
    if (rule && [...rows.values()].some(d => rule.every(k => d.data[k] === data[k]))) {
        const e = new Error('dubbel'); e.status = 409; e.reason = 'unique_violation'; throw e;
    }
    const doc = { id, data };
    rows.set(id, doc);
    return doc;
}

const fake = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => (raw += c));
    req.on('end', () => {
        const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
        if (req.headers.authorization !== 'ApiKey testkey') return send(401, { message: 'nee' });
        const url = new URL(req.url, 'http://x');
        const body = raw ? JSON.parse(raw) : {};
        const m = url.pathname.match(/^\/api\/t1\/(?:collections\/([^/]+)\/documents(?:\/([^/]+))?|(transactions))$/);
        try {
            if (m && m[3]) {
                const snapshot = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, new Map(v)]));
                try {
                    for (const op of body.operations) {
                        if (op.action === 'create') fakeCreate(op.collectionId, op.data, op.id);
                        if (op.action === 'delete') docs[op.collectionId].delete(op.id);
                    }
                } catch (e) { Object.keys(docs).forEach(k => delete docs[k]); Object.assign(docs, snapshot); throw e; }
                return send(200, { results: [] });
            }
            if (!m) return send(404, { message: 'onbekend' });
            const [, coll, id] = m;
            const rows = (docs[coll] ||= new Map());
            if (req.method === 'POST') return send(200, fakeCreate(coll, body.data));
            if (req.method === 'PATCH') { const d = rows.get(id); d.data = body.data; return send(200, d); }
            if (req.method === 'DELETE') { rows.delete(id); return send(200, { ok: true }); }
            const list = [...rows.values()].filter(d => [...url.searchParams].every(([k, v]) =>
                k === 'limit' || !v.startsWith('eq.') || String(d.data[k]) === v.slice(3)));
            send(200, { documents: list, limit: 1000, offset: 0, count: list.length });
        } catch (e) { send(e.status || 500, { message: e.message, reason: e.reason }); }
    });
});

// --- verdeling ---
test('verdeling: niemand trekt zichzelf of een gezinsgenoot, en iedereen wordt precies één keer getrokken', () => {
    const names = ['Anna', 'Bram', 'Cor', 'Dirk', 'Eva', 'Fien'];
    const families = { Anna: 'A', Bram: 'A', Cor: 'B', Dirk: 'B', Eva: 'C', Fien: 'C' };
    for (let i = 0; i < 200; i++) {
        const result = createAssignments(names, families, true);
        assert.deepEqual(Object.values(result).sort(), [...names].sort());
        for (const [giver, receiver] of Object.entries(result)) {
            assert.notEqual(giver, receiver);
            assert.notEqual(families[giver], families[receiver]);
        }
    }
});

test('verdeling: onmogelijke situatie geeft null', () => {
    const families = { Anna: 'A', Bram: 'A', Cor: 'A', Dirk: 'B' };
    assert.equal(createAssignments(Object.keys(families), families, true, 50), null);
});

// --- API ---
test('hele flow: aanmaken, trekken, herstel en verwijderen', async t => {
    await new Promise(r => fake.listen(0, r));
    Object.assign(process.env, {
        APENKAAS_URL: `http://127.0.0.1:${fake.address().port}`, APENKAAS_TENANT: 't1', APENKAAS_KEY: 'testkey',
        APENKAAS_LOTEN_COLLECTION_ID: 'loten', APENKAAS_DEELNEMERS_COLLECTION_ID: 'deelnemers',
        APENKAAS_HERSTEL_COLLECTION_ID: 'herstel', APENKAAS_HERSTEL_KLIKS_COLLECTION_ID: 'kliks'
    });
    const { server } = require('./server');
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => { server.close(); fake.close(); server.closeAllConnections?.(); });

    const post = async (path, body) => {
        const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: res.status, ...(await res.json()) };
    };
    const names = ['Anna', 'Bram', 'Cor', 'Dirk'];
    const admin = { username: 'baas', password: 'geheim' };

    // validatie
    assert.equal((await post('/api/admin/create', { eventName: 'X', adminUsername: 'baas', adminPassword: 'geheim', participants: ['A', 'a', 'B'] })).status, 400);
    assert.equal((await post('/api/admin/create', { eventName: 'X', adminUsername: 'baas', adminPassword: 'geheim', participants: ['A', 'B'] })).status, 400);

    const created = await post('/api/admin/create', { eventName: '<b>Test</b>', adminUsername: 'baas', adminPassword: 'geheim', participants: names });
    assert.ok(created.success, created.message);
    const { eventUrl } = created;

    // wachtwoord staat niet leesbaar in de opslag
    const stored = [...docs.loten.values()][0].data;
    assert.ok(!JSON.stringify(stored).includes('geheim'));

    // inloggen
    assert.equal((await post('/api/admin/login', { eventUrl, username: 'baas', password: 'fout' })).status, 401);
    assert.ok((await post('/api/admin/login', { eventUrl, ...admin })).success);
    assert.equal((await post('/api/admin/config', { eventUrl, username: 'baas', password: 'fout' })).status, 401);

    // loting zonder eventUrl lekt niets
    assert.equal((await fetch(`${base}/api/status`).then(r => r.json())).exists, false);
    assert.equal((await post('/api/draw', { name: 'Anna' })).status, 404);

    // trekken (hoofdletterongevoelig) en status
    const draw = await post('/api/draw', { name: 'anna', eventUrl });
    assert.ok(draw.success);
    assert.equal(draw.giver, 'Anna');
    assert.notEqual(draw.recipient, 'Anna');
    const status = await fetch(`${base}/api/status?eventUrl=${eventUrl}`).then(r => r.json());
    assert.deepEqual(status.viewedBy, ['Anna']);
    assert.equal((await post('/api/draw', { name: 'Niemand', eventUrl })).status, 404);

    // een tweede keer trekken geeft het lootje niet nog eens prijs
    const again = await post('/api/draw', { name: 'Anna', eventUrl });
    assert.equal(again.status, 409);
    assert.equal(again.recipient, undefined);

    // herstel: zonder mailconfiguratie weigert de server netjes
    const rec = await post('/api/recovery/create', { eventUrl, ...admin, recoveryEmail: 'a@b.nl' });
    assert.equal(rec.status, 503);

    // verwijderen ruimt alles op
    assert.equal((await post('/api/admin/delete', { eventUrl, username: 'baas', password: 'fout' })).status, 401);
    assert.ok((await post('/api/admin/delete', { eventUrl, ...admin })).success);
    assert.equal([...docs.loten.values()].length + [...docs.deelnemers.values()].length, 0);
    assert.equal((await fetch(`${base}/api/status?eventUrl=${eventUrl}`).then(r => r.json())).exists, false);
});
