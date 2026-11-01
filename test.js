// Draait met: npm test. Gebruikt een nep-Apenkaas (zelfde API-vorm als docs/app-aansluiten.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { createAssignments } = require('./assign');

// --- nep-Apenkaas ---
const docs = {}; // collectionId -> Map(id -> doc)
const files = new Set(); // ids van geüploade bestanden in de nep-opslag
const registered = new Map(); // e-mail -> gebruiker
const resetRequests = [];
let lastRegisterPassword = '';
let lastFileRequest = null; // laatste aanvraag om een bestand aan te maken
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
        if (req.url === '/upload') { res.writeHead(204); return res.end(); }
        if (req.headers.authorization !== 'ApiKey testkey' && !/\/(oauth\/token|logout|register|password-reset\/(request|confirm))$/.test(req.url)) return send(401, { message: 'nee' });
        const url = new URL(req.url, 'http://x');
        const body = raw ? JSON.parse(raw) : {};
        const m = url.pathname.match(/^\/api\/t1\/(?:collections\/([^/]+)\/documents(?:\/([^/]+))?|(transactions)|(oauth\/token)|(logout)|storage\/buckets\/([^/]+)\/files|storage\/files\/([^/]+)|(register)|(password-reset\/request)|(password-reset\/confirm))$/);
        try {
            if (m && m[4]) { // oauth/token: code 'good' = gebruiker u1, 'other' = u2
                const users = { good: { id: 'u1', email: 'a@b.nl' }, other: { id: 'u2', email: 'c@d.nl' } };
                const user = body.app_id === 'app1' && body.redirect_uri === 'http://localhost:3000/auth/callback' && body.code_verifier && users[body.code];
                return user ? send(200, { accessToken: 'x', refreshToken: 'r', user }) : send(400, { error: 'invalid_grant' });
            }
            if (m && m[5]) return send(200, { ok: true });
            if (m && m[6]) { // bestand aanmaken: metadata + uploadgegevens
                const file = { id: crypto.randomUUID() };
                lastFileRequest = body;
                files.add(file.id);
                return send(200, { file, uploadUrl: `http://127.0.0.1:${fake.address().port}/upload`, fields: { key: 'k' } });
            }
            if (m && m[7]) { files.delete(m[7]); return send(200, { ok: true }); }
            if (m && m[8]) { // registreren: wachtwoord minstens 8 tekens, e-mail uniek
                if (registered.has(body.email)) return send(400, { error: 'validation_error', message: 'E-mailadres is al in gebruik' });
                if (String(body.password).length < 8) return send(400, { error: 'validation_error', message: 'Wachtwoord moet minstens 8 tekens zijn' });
                lastRegisterPassword = body.password;
                const user = { id: `n${registered.size + 1}`, email: body.email, role: 'member' };
                registered.set(body.email, user);
                return send(200, user);
            }
            if (m && m[9]) { resetRequests.push(body.email); return send(200, { ok: true }); }
            if (m && m[10]) {
                const ok = body.token === 'goede-token-1234567890' && String(body.newPassword).length >= 8;
                return ok ? send(200, { ok: true }) : send(400, { error: 'invalid_token', message: 'Ongeldig of verlopen token' });
            }
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
test('hele flow: inloggen, aanmaken, trekken, koppelen, herstel en verwijderen', async t => {
    await new Promise(r => fake.listen(0, r));
    Object.assign(process.env, {
        APENKAAS_URL: `http://127.0.0.1:${fake.address().port}`, APENKAAS_TENANT: 't1', APENKAAS_KEY: 'testkey',
        APENKAAS_LOTEN_COLLECTION_ID: 'loten', APENKAAS_DEELNEMERS_COLLECTION_ID: 'deelnemers',
        APENKAAS_HERSTEL_COLLECTION_ID: 'herstel', APENKAAS_HERSTEL_KLIKS_COLLECTION_ID: 'kliks',
        RATE_LIMIT_STRICT: '1000', APENKAAS_ACHTERGRONDEN_BUCKET_ID: 'bucket1', APENKAAS_APP_ID: 'app1', SESSION_SECRET: 'x'.repeat(40), BASE_URL: 'http://localhost:3000'
    });
    const store = require('./store');
    const { server, mail } = require('./server');
    await new Promise(r => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    t.after(() => { server.close(); fake.close(); server.closeAllConnections?.(); });

    const call = async (method, path, body, cookie) => {
        const res = await fetch(base + path, {
            method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            body: body ? JSON.stringify(body) : undefined
        });
        const set = res.headers.get('set-cookie');
        return { status: res.status, cookie: set ? set.split(';')[0] : null, ...(await res.json()) };
    };
    const login = async code => (await call('POST', '/api/auth/callback', { code, verifier: 'v'.repeat(50) })).cookie;
    const names = ['Anna', 'Bram', 'Cor', 'Dirk'];

    // inloggen
    assert.equal((await call('GET', '/api/auth/me')).loggedIn, false);
    assert.equal((await call('POST', '/api/auth/callback', { code: 'fout', verifier: 'v'.repeat(50) })).status, 401);
    const alice = await login('good');
    const bob = await login('other');
    assert.ok(alice && bob);
    assert.equal((await call('GET', '/api/auth/me', null, alice)).email, 'a@b.nl');
    assert.equal((await call('GET', '/api/auth/me', null, alice.slice(0, -3) + 'abc')).loggedIn, false); // vervalst

    // aanmaken vereist een account en geldige invoer
    assert.equal((await call('POST', '/api/admin/create', { eventName: 'X', participants: names })).status, 401);
    assert.equal((await call('POST', '/api/admin/create', { eventName: 'X', participants: ['A', 'a', 'B'] }, alice)).status, 400);
    assert.equal((await call('POST', '/api/admin/create', { eventName: 'X', participants: ['A', 'B'] }, alice)).status, 400);
    const created = await call('POST', '/api/admin/create', { eventName: '<b>Test</b>', participants: names }, alice);
    assert.ok(created.success, created.message);
    const { eventUrl } = created;
    const stored = [...docs.loten.values()].find(d => d.data.eventUrl === eventUrl).data;
    assert.equal(stored.ownerId, 'u1');
    assert.equal(stored.adminHash, undefined);

    // alleen de eigenaar beheert
    assert.equal((await call('GET', '/api/admin/lotteries', null, alice)).lotteries.length, 1);
    assert.equal((await call('GET', '/api/admin/lotteries', null, bob)).lotteries.length, 0);
    assert.equal((await call('GET', `/api/admin/lottery/${eventUrl}`, null, alice)).participants.length, 4);
    const foreign = await call('GET', `/api/admin/lottery/${eventUrl}`, null, bob);
    assert.equal(foreign.status, 403);
    assert.equal(foreign.claimable, false);
    assert.equal((await call('GET', `/api/admin/lottery/${eventUrl}`)).status, 401);

    // trekken: publiek, alleen met loting-code
    assert.equal((await call('GET', '/api/status')).exists, false);
    assert.equal((await call('POST', '/api/draw', { name: 'Anna' })).status, 404);
    const draw = await call('POST', '/api/draw', { name: 'anna', eventUrl });
    assert.ok(draw.success);
    assert.equal(draw.giver, 'Anna');
    assert.notEqual(draw.recipient, 'Anna');
    assert.deepEqual((await call('GET', `/api/status?eventUrl=${eventUrl}`)).viewedBy, ['Anna']);
    assert.equal((await call('POST', '/api/draw', { name: 'Niemand', eventUrl })).status, 404);

    // gelijktijdig trekken: precies één verzoek krijgt het lootje
    const racers = await Promise.all([1, 2, 3, 4].map(() => call('POST', '/api/draw', { name: 'Bram', eventUrl })));
    assert.equal(racers.filter(r => r.success).length, 1);
    assert.equal(racers.filter(r => r.status === 409 && r.recipient === undefined).length, 3);
    assert.equal((await call('POST', '/api/draw', { name: 'Anna', eventUrl })).status, 409);

    // uiterlijk: alleen de eigenaar, met geldige waarden
    const setDesign = (cookie, body) => call('POST', '/api/admin/design', { eventUrl, ...body }, cookie);
    assert.equal((await setDesign(bob, { theme: 'nacht', welcome: 'Hoi' })).status, 403);
    assert.equal((await setDesign(alice, { theme: 'neon', welcome: '' })).status, 400);
    assert.equal((await setDesign(alice, { theme: 'nacht', welcome: 'x'.repeat(141) })).status, 400);
    assert.ok((await setDesign(alice, { theme: 'nacht', welcome: '  Veel   plezier ' })).success);
    assert.deepEqual((await call('GET', `/api/status?eventUrl=${eventUrl}`)).design, { theme: 'nacht', welcome: 'Veel plezier', backgroundUrl: null });

    // achtergrondfoto: alleen JPEG, alleen de eigenaar; een nieuwe foto ruimt de oude op
    const upload = (cookie, buf) => fetch(`${base}/api/admin/background?eventUrl=${eventUrl}`, {
        method: 'POST', headers: { 'Content-Type': 'image/jpeg', Cookie: cookie }, body: buf
    }).then(async r => ({ status: r.status, ...(await r.json()) }));
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000)]);
    assert.equal((await upload(alice, Buffer.alloc(2000))).status, 400);
    assert.equal((await upload(bob, jpeg)).status, 403);
    const first = await upload(alice, jpeg);
    assert.ok(first.success);
    assert.match(first.backgroundUrl, /\/storage\/files\/[^/]+\/view$/);
    assert.equal(files.size, 1);
    // publiek leesbaar, als JPEG, en zonder loting-code in de metadata
    assert.deepEqual(lastFileRequest.readPermissions, ['any']);
    assert.equal(lastFileRequest.mimeType, 'image/jpeg');
    assert.equal(lastFileRequest.grootte, jpeg.length);
    assert.ok(!JSON.stringify(lastFileRequest).includes(eventUrl));
    const second = await upload(alice, jpeg);
    assert.notEqual(second.backgroundUrl, first.backgroundUrl);
    assert.equal(files.size, 1);
    assert.equal((await call('GET', `/api/status?eventUrl=${eventUrl}`)).design.backgroundUrl, second.backgroundUrl);
    assert.ok((await call('POST', '/api/admin/background/delete', { eventUrl }, alice)).success);
    assert.equal(files.size, 0);
    assert.equal((await call('GET', `/api/status?eventUrl=${eventUrl}`)).design.backgroundUrl, null);
    assert.ok((await upload(alice, jpeg)).success); // blijft staan tot de loting wordt verwijderd

    // oude loting koppelen met de oude gegevens
    const oldUrl = 'b'.repeat(16);
    fakeCreate('loten', { eventUrl: oldUrl, eventName: 'Oud', adminUsername: 'eelko', adminHash: store.hashPassword('oudww'), familyMode: false });
    const legacy = await call('GET', `/api/admin/lottery/${oldUrl}`, null, bob);
    assert.equal(legacy.status, 403);
    assert.equal(legacy.claimable, true);
    assert.equal((await call('POST', '/api/admin/claim', { eventUrl: oldUrl, username: 'eelko', password: 'fout' }, bob)).status, 401);
    assert.ok((await call('POST', '/api/admin/claim', { eventUrl: oldUrl, username: 'eelko', password: 'oudww' }, bob)).success);
    assert.equal((await call('GET', `/api/admin/lottery/${oldUrl}`, null, bob)).eventName, 'Oud');
    assert.equal((await call('POST', '/api/admin/claim', { eventUrl: oldUrl, username: 'eelko', password: 'oudww' }, alice)).status, 401); // al gekoppeld

    // herstel: alleen de eigenaar; zonder mailconfiguratie weigert de server netjes
    assert.equal((await call('POST', '/api/recovery/create', { eventUrl, recoveryEmail: 'a@b.nl' }, bob)).status, 403);
    assert.equal((await call('POST', '/api/recovery/create', { eventUrl, recoveryEmail: 'a@b.nl' }, alice)).status, 503);

    // verwijderen: alleen de eigenaar, en het ruimt alles op
    assert.equal((await call('POST', '/api/admin/delete', { eventUrl }, bob)).status, 403);
    const deleted = await call('POST', '/api/admin/delete', { eventUrl }, alice);
    assert.ok(deleted.success, JSON.stringify(deleted));
    assert.equal([...docs.deelnemers.values()].filter(d => d.data.eventUrl === eventUrl).length, 0);
    assert.equal((await call('GET', `/api/status?eventUrl=${eventUrl}`)).exists, false);
    assert.equal(files.size, 0);

    // oude organisator zet zijn account om: oude gegevens plus e-mailadres worden een account
    const legacyCode = 'c'.repeat(16);
    fakeCreate('loten', { eventUrl: legacyCode, eventName: 'Oud 2', adminUsername: 'oma', adminHash: store.hashPassword('oudww2'), familyMode: false });
    const legacyRow = () => [...docs.loten.values()].find(d => d.data.eventUrl === legacyCode).data;
    const convert = body => call('POST', '/api/admin/convert', {
        eventUrl: legacyCode, username: 'oma', password: 'oudww2', email: 'Oma@Example.nl', emailRepeat: 'oma@example.nl', ...body
    });
    assert.equal((await convert({ password: 'fout' })).status, 401);                  // oude gegevens kloppen niet
    assert.equal((await convert({ emailRepeat: 'anders@example.nl' })).status, 400);  // twee keer hetzelfde adres
    assert.equal((await convert({ email: 'geen-adres', emailRepeat: 'geen-adres' })).status, 400);
    assert.equal(registered.size, 0);                                                 // niets aangemaakt
    registered.set('bestaat@example.nl', { id: 'x1', email: 'bestaat@example.nl' });
    assert.equal((await convert({ email: 'bestaat@example.nl', emailRepeat: 'bestaat@example.nl' })).status, 409);
    assert.equal(legacyRow().ownerId, undefined);                                     // loting blijft koppelbaar
    const converted = await convert({});
    assert.ok(converted.success && converted.mailRequested);
    assert.equal(converted.email, 'oma@example.nl');                                  // adres genormaliseerd
    assert.equal(legacyRow().ownerId, registered.get('oma@example.nl').id);
    assert.equal(legacyRow().ownerEmail, 'oma@example.nl');
    assert.deepEqual(resetRequests, ['oma@example.nl']);                              // mail aangevraagd bij Apenkaas
    assert.ok(lastRegisterPassword.length >= 8);                                      // willekeurig wachtwoord, nooit het oude
    assert.notEqual(lastRegisterPassword, 'oudww2');
    assert.equal((await convert({})).status, 401);                                    // is nu al gekoppeld
    assert.equal((await call('GET', '/api/auth/me')).loggedIn, false);                // omzetten logt niet in

    // wachtwoord kiezen via de link uit de mail
    const choose = (token, password) => call('POST', '/api/auth/reset', { token, password });
    assert.equal((await choose('goede-token-1234567890', 'kort')).status, 400);
    assert.equal((await choose('x', 'langgenoeg1')).status, 400);
    assert.equal((await choose('verkeerde-token-1234567890', 'langgenoeg1')).status, 400);
    assert.ok((await choose('goede-token-1234567890', 'langgenoeg1')).success);

    // webhook "wachtwoord vergeten": Apenkaas meldt het, wij sturen de mail
    const hook = async (payload, { secret = 'geheim-voor-test', signature } = {}) => {
        const body = JSON.stringify(payload);
        const sig = signature ?? 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
        const res = await fetch(`${base}/api/webhooks/apenkaas`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Apenkaas-Signature': sig }, body
        });
        return { status: res.status, ...(await res.json()) };
    };
    const reset = {
        event: 'user.password_reset_requested', tenant_id: 't1', timestamp: 'nu',
        data: { email: 'anna@example.nl', naam: 'Anna <b>', reset_url: `${process.env.APENKAAS_URL}/login/t1/app1/nieuw-wachtwoord?flow=abc` }
    };
    const sentMail = [];
    mail.transporter = { sendMail: async m => { sentMail.push(m); } };

    assert.equal((await hook(reset)).status, 503);                                  // geen geheim ingesteld
    process.env.APENKAAS_WEBHOOK_SECRET = 'geheim-voor-test';
    assert.equal((await hook(reset, { secret: 'verkeerd' })).status, 401);          // verkeerde handtekening
    assert.equal((await hook(reset, { signature: '' })).status, 401);               // geen handtekening
    assert.equal((await hook({ ...reset, tenant_id: 'andere' })).status, 400);      // andere tenant
    assert.equal((await hook({ ...reset, event: 'user.register' })).ignored, true); // andere gebeurtenis
    assert.equal((await hook({ ...reset, data: { ...reset.data, reset_url: 'https://evil.example/nieuw-wachtwoord' } })).status, 400); // link buiten Apenkaas
    assert.equal(sentMail.length, 0);
    assert.ok((await hook(reset)).success);
    assert.equal(sentMail.length, 1);
    assert.equal(sentMail[0].to, 'anna@example.nl');
    assert.ok(sentMail[0].html.includes('nieuw-wachtwoord?flow=abc'));
    assert.ok(!sentMail[0].html.includes('<b>'));                                   // naam is geëscaped
    const tokenOnly = { ...reset, data: { email: 'oma@example.nl', naam: null, token: 'goede-token-1234567890', reset_url: null } };
    assert.ok((await hook(tokenOnly)).success);                                     // zonder reset_url: eigen link met token
    assert.ok(sentMail.at(-1).html.includes('http://localhost:3000/nieuw-wachtwoord?token=goede-token-1234567890'));
    assert.equal((await hook({ ...tokenOnly, data: { ...tokenOnly.data, token: 'x' } })).status, 400);
    assert.equal((await hook({ ...tokenOnly, data: { ...tokenOnly.data, token: undefined } })).status, 400);
    mail.transporter = { sendMail: async () => { throw new Error('smtp stuk'); } };
    assert.equal((await hook(reset)).status, 503);                                  // mail mislukt: Apenkaas probeert later opnieuw

    // uitloggen wist de cookie
    assert.match((await fetch(base + '/api/auth/logout', { method: 'POST' })).headers.get('set-cookie'), /Max-Age=0/);
});
