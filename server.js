const express = require('express');
const http = require('http');
const path = require('path');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const store = require('./store');
const { createAssignments } = require('./assign');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const baseUrl = () => process.env.BASE_URL || `http://localhost:${PORT}`;
const MIN_PARTICIPANTS = 3;
const MAX_PARTICIPANTS = 50; // past in één Apenkaas-transactie (max. 100 acties)

if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || true);

// --- E-mail ---
const emailTransporter = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    : null;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Begrenst uitgaande mail zodat de server geen mailrelay wordt. Elke soort mail heeft een eigen budget,
// zodat misbruik van de open "loting aanmaken" de herstelmail niet blokkeert.
// Per uur: 40 in totaal; aanmaakmail (open voor iedereen) krijgt daar maximaal 20 van, zodat de
// herstelmail altijd ruimte houdt. Per soort geldt verder 3 per adres en 5 per IP.
// ponytail: in het geheugen, werkt voor één serverinstantie.
const MAIL_KIND_CAP = { create: 20, recovery: 30 };
const sentMail = [];
function mailAllowed(kind, to, ip) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (sentMail.length && sentMail[0].at < cutoff) sentMail.shift();
    const addr = to.toLowerCase();
    const ofKind = sentMail.filter(m => m.kind === kind);
    if (sentMail.length >= 40 || ofKind.length >= MAIL_KIND_CAP[kind]) return false;
    if (ofKind.filter(m => m.to === addr).length >= 3) return false;
    if (ip && ofKind.filter(m => m.ip === ip).length >= 5) return false;
    sentMail.push({ kind, to: addr, ip, at: Date.now() });
    return true;
}

async function sendMail(kind, to, subject, html, ip) {
    if (!emailTransporter || !mailAllowed(kind, to, ip)) return false;
    try {
        await emailTransporter.sendMail({ from: process.env.GMAIL_USER, to, subject, html });
        return true;
    } catch (error) {
        console.error('Mail versturen mislukt:', error.message);
        return false;
    }
}

const mailFrame = body => `
    <div style="font-family: Georgia, serif; max-width: 560px; margin: 0 auto; color: #2a1810;">
        <h1 style="color: #b11e2d;">Sinterklaas Lootjes</h1>
        ${body}
        <hr style="border: none; border-top: 1px solid #e6d8c0; margin: 28px 0;">
        <p style="color: #8a7a68; font-size: 12px;">Automatisch bericht van Sinterklaas Lootjes.</p>
    </div>`;

// Onderwerp is vast en het wachtwoord staat er bewust niet in: de maker kent het al.
function sendAdminCredentialsEmail(email, eventName, eventUrl, username, ip) {
    const adminUrl = `${baseUrl()}/admin/${eventUrl}`;
    const participantUrl = `${baseUrl()}/event/${eventUrl}`;
    return sendMail('create', email, 'Je Sinterklaas Lootjes-loting staat klaar', mailFrame(`
        <h2>Je loting "${esc(eventName)}" staat klaar</h2>
        <p><strong>Gebruikersnaam:</strong> ${esc(username)}<br>Het wachtwoord is het wachtwoord dat je zelf hebt gekozen.</p>
        <p><strong>Beheerlink:</strong><br><a href="${esc(adminUrl)}">${esc(adminUrl)}</a></p>
        <p><strong>Link voor deelnemers:</strong><br><a href="${esc(participantUrl)}">${esc(participantUrl)}</a></p>
        <p style="color: #8a7a68;">Bewaar deze mail: je hebt de gegevens nodig om je loting te beheren.</p>`), ip);
}

function sendRecoveryEmail(email, eventName, recipientName, ip) {
    return sendMail('recovery', email, 'Je Sinterklaas lootje', mailFrame(`
        <h2>Je lootje van "${esc(eventName)}"</h2>
        <p>Jij mag een surprise maken voor:</p>
        <p style="font-size: 26px; font-weight: bold; color: #b11e2d;">${esc(recipientName)}</p>
        <p>Veel plezier met het uitzoeken van een cadeau!</p>`), ip);
}

// --- Middleware ---
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ponytail: in-memory teller per IP, werkt voor één server-instantie.
const hits = new Map();
setInterval(() => hits.clear(), 60 * 1000).unref();
function rateLimit(max) {
    return (req, res, next) => {
        const n = (hits.get(req.ip) || 0) + 1;
        hits.set(req.ip, n);
        if (n > max) return res.status(429).json({ success: false, message: 'Te veel pogingen, probeer het over een minuut opnieuw.' });
        next();
    };
}
const strict = rateLimit(30);

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// --- Validatie ---
const cleanText = (v, max) => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim();
    return t && t.length <= max ? t : null;
};
const isEmail = v => typeof v === 'string' && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const isCode = v => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v);

// --- Pagina's ---
const page = name => (req, res) => res.sendFile(path.join(__dirname, 'public', name));
app.get('/event/:eventUrl', page('index.html'));
app.get('/admin/:eventUrl', page('admin.html'));
app.get('/recovery/:recoveryUrl', page('recovery.html'));

io.on('connection', socket => {
    socket.on('join-event', code => isCode(code) && socket.join(`event:${code}`));
    socket.on('join-recovery', code => isCode(code) && socket.join(`recovery:${code}`));
});

// --- Admin ---
async function authAdmin(req, res) {
    const { eventUrl, username, password } = req.body;
    if (!isCode(eventUrl) || typeof username !== 'string' || typeof password !== 'string') {
        fail(res, 400, 'Alle velden zijn verplicht');
        return false;
    }
    if (!(await store.verifyAdmin(eventUrl, username.trim(), password.trim()))) {
        fail(res, 401, 'Ongeldige inloggegevens');
        return false;
    }
    return true;
}

app.post('/api/admin/login', strict, wrap(async (req, res) => {
    if (await authAdmin(req, res)) res.json({ success: true });
}));

app.post('/api/admin/config', strict, wrap(async (req, res) => {
    if (!(await authAdmin(req, res))) return;
    res.json({ success: true, ...(await store.getLotteryData(req.body.eventUrl)) });
}));

app.post('/api/admin/create', strict, wrap(async (req, res) => {
    const { adminEmail, familyMode } = req.body;
    const eventName = cleanText(req.body.eventName, 80);
    const adminUsername = cleanText(req.body.adminUsername, 40);
    const adminPassword = typeof req.body.adminPassword === 'string' ? req.body.adminPassword.trim() : '';

    if (!eventName || !adminUsername || adminPassword.length < 4 || adminPassword.length > 200) {
        return fail(res, 400, 'Loting-naam, gebruikersnaam en een wachtwoord van minimaal 4 tekens zijn verplicht');
    }
    if (adminEmail && !isEmail(adminEmail)) return fail(res, 400, 'Ongeldig e-mailadres');

    const names = Array.isArray(req.body.participants) ? req.body.participants.map(n => cleanText(n, 40)) : [];
    if (names.length < MIN_PARTICIPANTS || names.length > MAX_PARTICIPANTS || names.includes(null)) {
        return fail(res, 400, `Je hebt ${MIN_PARTICIPANTS} tot ${MAX_PARTICIPANTS} geldige namen nodig`);
    }
    if (new Set(names.map(n => n.toLowerCase())).size !== names.length) {
        return fail(res, 400, 'Elke naam mag maar één keer voorkomen (hoofdletters tellen niet mee)');
    }

    const families = {};
    if (familyMode) {
        const input = req.body.families || {};
        for (const name of names) {
            const family = cleanText(input[name], 40);
            if (!family) return fail(res, 400, `Geef ${name} een gezinsnaam`);
            families[name] = family;
        }
        if (new Set(Object.values(families)).size < 2) return fail(res, 400, 'Je hebt minimaal 2 gezinnen nodig');
    }

    const assignments = createAssignments(names, families, !!familyMode);
    if (!assignments) return fail(res, 400, 'Kon geen geldige verdeling maken. Controleer de gezinsverdeling.');

    const eventUrl = await store.createLottery({
        eventName, adminUsername, adminPassword, participants: names, families, familyMode: !!familyMode, assignments
    });

    let mailed = false;
    if (adminEmail && adminEmail.trim()) {
        mailed = await sendAdminCredentialsEmail(adminEmail.trim(), eventName, eventUrl, adminUsername, req.ip);
    }

    res.json({
        success: true,
        message: mailed ? 'Loting aangemaakt! Check je e-mail voor de inloggegevens.' : 'Loting aangemaakt!',
        eventUrl,
        adminUrl: `/admin/${eventUrl}`,
        participantUrl: `/event/${eventUrl}`
    });
}));

app.post('/api/admin/delete', strict, wrap(async (req, res) => {
    if (!(await authAdmin(req, res))) return;
    await store.deleteLottery(req.body.eventUrl);
    io.to(`event:${req.body.eventUrl}`).emit('lottery-reset');
    res.json({ success: true, message: 'Loting verwijderd' });
}));

// --- Deelnemers ---
const drawing = new Set();
app.post('/api/draw', rateLimit(120), wrap(async (req, res) => {
    const name = cleanText(req.body.name, 40);
    const { eventUrl } = req.body;
    if (!name) return fail(res, 400, 'Voer je naam in');
    if (!isCode(eventUrl)) return fail(res, 404, 'Deze loting bestaat niet. Vraag de organisator om de juiste link.');

    // Slot per persoon, gezet vóór het eerste await: een tweede gelijktijdig verzoek kan het lootje
    // niet meer meepakken. ponytail: werkt voor één serverinstantie (Apenkaas kent geen voorwaardelijke
    // update); bij meerdere instanties een uniek claim-document per deelnemer aanmaken.
    const key = `${eventUrl}:${name.toLowerCase()}`;
    const alreadyDrawn = () => fail(res, 409, 'Dit lootje is al getrokken. Is het kwijt? Vraag de organisator om een herstellink.');
    if (drawing.has(key)) return alreadyDrawn();
    drawing.add(key);

    try {
        const assignment = await store.getAssignment(eventUrl, name);
        if (!assignment) {
            const status = await store.getLotteryStatus(eventUrl);
            return fail(res, 404, status.exists
                ? 'Deze naam staat niet in de lijst. Controleer de spelling.'
                : 'Deze loting bestaat niet (meer). Neem contact op met de organisator.');
        }

        // Eén keer trekken: daarna geeft de server het lootje niet meer prijs (herstel loopt via de herstelflow).
        if (assignment.viewed) return alreadyDrawn();

        await store.markAsViewed(assignment);
        const status = await store.getLotteryStatus(eventUrl);
        io.to(`event:${eventUrl}`).emit('participant-viewed', {
            name: assignment.giver, viewedBy: status.viewedBy, viewedCount: status.viewedCount
        });

        res.json({ success: true, giver: assignment.giver, recipient: assignment.recipient, family: assignment.family });
    } finally {
        drawing.delete(key);
    }
}));

app.get('/api/status', wrap(async (req, res) => {
    res.json(await store.getLotteryStatus(isCode(req.query.eventUrl) ? req.query.eventUrl : null));
}));

// --- Herstel ---
app.post('/api/recovery/create', strict, wrap(async (req, res) => {
    if (!(await authAdmin(req, res))) return;
    if (!isEmail(req.body.recoveryEmail)) return fail(res, 400, 'Voer een geldig e-mailadres in');
    if (!emailTransporter) return fail(res, 503, 'E-mail is niet ingesteld op de server, herstel kan dus geen mail sturen.');

    const recoveryUrl = await store.createRecoverySession(req.body.eventUrl, req.body.recoveryEmail.trim());
    if (!recoveryUrl) return fail(res, 404, 'Loting niet gevonden');
    res.json({ success: true, recoveryUrl, fullUrl: `${baseUrl()}/recovery/${recoveryUrl}` });
}));

app.get('/api/recovery/:recoveryUrl', wrap(async (req, res) => {
    const session = isCode(req.params.recoveryUrl) && await store.getRecoverySession(req.params.recoveryUrl);
    if (!session) return fail(res, 404, 'Herstelsessie niet gevonden');
    // Geen klikgegevens teruggeven: wie wat aanklikte blijft geheim.
    res.json({
        success: true,
        eventName: session.eventName,
        participants: session.participants,
        clickCount: session.clickCount,
        totalParticipants: session.totalParticipants,
        emailSent: session.emailSent
    });
}));

app.post('/api/recovery/click', rateLimit(120), wrap(async (req, res) => {
    const { recoveryUrl, recipientName } = req.body;
    if (!isCode(recoveryUrl) || typeof recipientName !== 'string') return fail(res, 400, 'Ongeldige aanvraag');

    const result = await store.registerRecoveryClick(recoveryUrl, recipientName);
    if (!result.success) return fail(res, 400, result.error);

    const room = io.to(`recovery:${recoveryUrl}`);
    const counts = { clickCount: result.clickCount, totalParticipants: result.totalParticipants };

    if (result.shouldSendEmail) {
        const sent = await sendRecoveryEmail(result.recoveryEmail, result.eventName, result.missingName, req.ip);
        if (!sent) {
            await store.removeRecoveryClick(result.clickId); // opnieuw proberen blijft mogelijk
            return fail(res, 503, 'De e-mail kon niet worden verstuurd. Probeer het zo nog eens.');
        }
        await store.markRecoveryEmailSent(result.session);
        room.emit('recovery-completed', counts);
        return res.json({ success: true, message: 'Bedankt! De mail is onderweg naar degene die het vergeten was.', ...counts, emailSent: true });
    }

    room.emit('recovery-click', counts);
    res.json({ success: true, message: 'Bedankt voor je klik!', ...counts, emailSent: false });
}));

// --- Fouten ---
app.use((err, req, res, next) => {
    console.error(req.method, req.path, err);
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'Ongeldige aanvraag');
    fail(res, 500, 'Er ging iets mis. Probeer het zo nog eens.');
});

if (require.main === module) {
    store.assertConfigured();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Sinterklaas Lootjes draait op http://0.0.0.0:${PORT} (backend: Apenkaas)`);
        console.log(emailTransporter ? 'E-mail ingesteld' : 'E-mail niet ingesteld: herstel-mails en inlogmails staan uit');
    });
}

module.exports = { app, server };
