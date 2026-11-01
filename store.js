// Opslaglaag: alle data staat in Apenkaas (collecties uit apenkaas.json).
// De server gebruikt een server-sleutel; de browser praat nooit direct met Apenkaas,
// zodat de verdeling (wie trekt wie) alleen via /api/draw naar buiten komt.
const crypto = require('crypto');

const cfg = () => ({
    url: (process.env.APENKAAS_URL || 'https://apenkaas.nl').replace(/\/$/, ''),
    tenant: process.env.APENKAAS_TENANT,
    key: process.env.APENKAAS_KEY,
    loten: process.env.APENKAAS_LOTEN_COLLECTION_ID,
    deelnemers: process.env.APENKAAS_DEELNEMERS_COLLECTION_ID,
    herstel: process.env.APENKAAS_HERSTEL_COLLECTION_ID,
    kliks: process.env.APENKAAS_HERSTEL_KLIKS_COLLECTION_ID
});

function assertConfigured() {
    const c = cfg();
    const missing = ['tenant', 'key', 'loten', 'deelnemers', 'herstel', 'kliks'].filter(k => !c[k]);
    if (missing.length) throw new Error(`Apenkaas niet ingesteld, ontbreekt: ${missing.join(', ')} (zie .env.example)`);
}

async function api(method, path, body) {
    const c = cfg();
    const res = await fetch(`${c.url}/api/${c.tenant}${path}`, {
        method,
        headers: { Authorization: `ApiKey ${c.key}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        const err = new Error((json && json.message) || `Apenkaas fout ${res.status}`);
        err.status = res.status;
        err.reason = json && json.reason;
        throw err;
    }
    return json;
}

const flat = d => ({ id: d.id, ...d.data });

async function find(collection, filters = {}) {
    const q = new URLSearchParams({ limit: '1000' });
    for (const [k, v] of Object.entries(filters)) q.set(k, `eq.${v}`);
    const res = await api('GET', `/collections/${collection}/documents?${q}`);
    return res.documents.map(flat);
}

const findOne = async (collection, filters) => (await find(collection, filters))[0] || null;
const create = async (collection, data) => flat(await api('POST', `/collections/${collection}/documents`, { data }));
// PATCH vervangt het hele document (geen merge): altijd de volledige rij meesturen.
const update = (collection, { id, ...row }, changes) =>
    api('PATCH', `/collections/${collection}/documents/${id}`, { data: { ...row, ...changes } });

// Transacties zijn beperkt tot 100 acties; in stukken verwerken.
async function transact(operations) {
    for (let i = 0; i < operations.length; i += 100) {
        await api('POST', '/transactions', { operations: operations.slice(i, i + 100) });
    }
}

// --- Wachtwoorden (scrypt, nooit leesbaar opgeslagen) ---
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function checkPassword(password, stored) {
    const [saltHex, hashHex] = String(stored).split(':');
    if (!saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
}

const sameText = (a, b) => {
    const x = crypto.createHash('sha256').update(String(a)).digest();
    const y = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(x, y);
};

// --- Loten ---
const getLottery = eventUrl => findOne(cfg().loten, { eventUrl });

// Eigenaar = Apenkaas-gebruiker. Oude lotingen (van vóór accounts) hebben nog een eigen
// gebruikersnaam en wachtwoord en kunnen met die gegevens aan een account worden gekoppeld.
const isOwner = (lottery, userId) => !!lottery && !!lottery.ownerId && lottery.ownerId === userId;
const isClaimable = lottery => !!lottery && !lottery.ownerId && !!lottery.adminHash;

async function claimLottery(eventUrl, user, username, password) {
    const lottery = await getLottery(eventUrl);
    // Altijd een hash berekenen, ook bij onbekende loting, zodat de responstijd niets verklapt.
    const ok = checkPassword(password, isClaimable(lottery) ? lottery.adminHash : hashPassword('x'));
    if (!isClaimable(lottery) || !sameText(lottery.adminUsername, username) || !ok) return false;
    await update(cfg().loten, lottery, { ownerId: user.id, ownerEmail: user.email });
    return true;
}

const listLotteries = async ownerId =>
    (await find(cfg().loten, { ownerId }))
        .map(l => ({ eventUrl: l.eventUrl, eventName: l.eventName, created: l.createdAt }))
        .sort((a, b) => String(b.created).localeCompare(String(a.created)));

async function createLottery({ eventName, owner, participants, families, familyMode, assignments }) {
    const c = cfg();
    const eventUrl = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();
    const ops = [{
        action: 'create', collectionId: c.loten,
        data: { eventUrl, eventName, ownerId: owner.id, ownerEmail: owner.email, familyMode: !!familyMode, createdAt }
    }];
    for (const naam of participants) {
        ops.push({
            action: 'create', collectionId: c.deelnemers,
            data: {
                eventUrl, naam, naamLower: naam.toLowerCase(), ontvanger: assignments[naam],
                bekeken: false, ...(familyMode ? { familie: families[naam] } : {})
            }
        });
    }
    await transact(ops);
    return eventUrl;
}

async function deleteLottery(eventUrl) {
    const c = cfg();
    const lottery = await getLottery(eventUrl);
    if (!lottery) return false;
    const ops = [];
    const del = (collectionId, docs) => docs.forEach(d => ops.push({ action: 'delete', collectionId, id: d.id }));
    const sessions = await find(c.herstel, { eventUrl });
    for (const s of sessions) del(c.kliks, await find(c.kliks, { recoveryUrl: s.recoveryUrl }));
    del(c.herstel, sessions);
    del(c.deelnemers, await find(c.deelnemers, { eventUrl }));
    del(c.loten, [lottery]);
    await transact(ops);
    return true;
}

// --- Deelnemers ---
const getParticipants = async eventUrl =>
    (await find(cfg().deelnemers, { eventUrl })).sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));

async function getLotteryData(eventUrl) {
    const lottery = await getLottery(eventUrl);
    if (!lottery) return null;
    const rows = await getParticipants(eventUrl);
    const families = {};
    rows.forEach(p => { if (p.familie) families[p.naam] = p.familie; });
    return {
        eventName: lottery.eventName,
        eventUrl,
        participants: rows.map(p => p.naam),
        families,
        familyMode: !!lottery.familyMode,
        created: lottery.createdAt,
        viewedBy: rows.filter(p => p.bekeken).map(p => p.naam)
    };
}

async function getLotteryStatus(eventUrl) {
    const lottery = eventUrl ? await getLottery(eventUrl) : null;
    if (!lottery) return { exists: false, participantCount: 0, viewedCount: 0, participants: [], viewedBy: [] };
    const rows = await getParticipants(eventUrl);
    const viewedBy = rows.filter(p => p.bekeken).map(p => p.naam);
    return {
        exists: true,
        participantCount: rows.length,
        viewedCount: viewedBy.length,
        participants: rows.map(p => p.naam),
        viewedBy,
        eventUrl,
        eventName: lottery.eventName
    };
}

async function getAssignment(eventUrl, name) {
    const p = await findOne(cfg().deelnemers, { eventUrl, naamLower: name.toLowerCase() });
    return p ? { row: p, giver: p.naam, recipient: p.ontvanger, family: p.familie || null, viewed: !!p.bekeken } : null;
}

// ponytail: lezen-dan-schrijven is niet atomair; twee gelijktijdige trekkingen van dezelfde
// persoon kunnen beide "nieuw" melden. Gevolg is alleen een dubbele melding, geen dataverlies.
async function markAsViewed(assignment) {
    if (assignment.viewed) return false;
    await update(cfg().deelnemers, assignment.row, { bekeken: true, bekekenOp: new Date().toISOString() });
    return true;
}

// --- Herstel ---
async function createRecoverySession(eventUrl, email) {
    if (!(await getLottery(eventUrl))) return null;
    const recoveryUrl = crypto.randomBytes(8).toString('hex');
    await create(cfg().herstel, { recoveryUrl, eventUrl, email, emailSent: false, createdAt: new Date().toISOString() });
    return recoveryUrl;
}

async function getRecoverySession(recoveryUrl) {
    const c = cfg();
    const session = await findOne(c.herstel, { recoveryUrl });
    if (!session) return null;
    const lottery = await getLottery(session.eventUrl);
    if (!lottery) return null;
    const [participants, clicks] = await Promise.all([getParticipants(session.eventUrl), find(c.kliks, { recoveryUrl })]);
    return {
        row: session,
        eventName: lottery.eventName,
        recoveryEmail: session.email,
        participants: participants.map(p => p.naam),
        clicks: clicks.map(k => ({ id: k.id, name: k.naam })),
        clickCount: clicks.length,
        totalParticipants: participants.length,
        emailSent: !!session.emailSent
    };
}

// Registreert een klik. Bij de voorlaatste klik (N-1) is de ontbrekende naam de uitkomst.
async function registerRecoveryClick(recoveryUrl, name) {
    const session = await getRecoverySession(recoveryUrl);
    if (!session) return { success: false, error: 'Herstelsessie niet gevonden' };
    if (session.emailSent) return { success: false, error: 'Herstel is al afgerond' };
    if (!session.participants.includes(name)) return { success: false, error: 'Naam niet gevonden' };
    if (session.clickCount >= session.totalParticipants - 1) return { success: false, error: 'Herstel is al afgerond' };

    let click;
    try {
        click = await create(cfg().kliks, { recoveryUrl, naam: name });
    } catch (err) {
        if (err.reason === 'unique_violation') return { success: false, error: 'Deze naam is al aangeklikt' };
        throw err;
    }

    // Opnieuw lezen: bij gelijktijdige kliks is alleen de database de waarheid.
    const clicked = new Set((await find(cfg().kliks, { recoveryUrl })).map(k => k.naam));
    const clickCount = clicked.size;
    if (clickCount > session.totalParticipants - 1) {
        await removeRecoveryClick(click.id);
        return { success: false, error: 'Gelijktijdige klik, probeer het nog eens' };
    }
    const result = { success: true, clickCount, totalParticipants: session.totalParticipants, clickId: click.id };
    if (clickCount === session.totalParticipants - 1) {
        return {
            ...result,
            shouldSendEmail: true,
            missingName: session.participants.find(n => !clicked.has(n)),
            recoveryEmail: session.recoveryEmail,
            eventName: session.eventName,
            session: session.row
        };
    }
    return { ...result, shouldSendEmail: false };
}

const removeRecoveryClick = clickId => api('DELETE', `/collections/${cfg().kliks}/documents/${clickId}`);
const markRecoveryEmailSent = session => update(cfg().herstel, session, { emailSent: true });

module.exports = {
    assertConfigured, getLottery, isOwner, isClaimable, claimLottery, listLotteries, hashPassword,
    getLotteryData, getLotteryStatus, createLottery, deleteLottery,
    getAssignment, markAsViewed, createRecoverySession, getRecoverySession, registerRecoveryClick,
    removeRecoveryClick, markRecoveryEmailSent
};
