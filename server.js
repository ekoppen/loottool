const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Server } = require('socket.io');
const store = require('./store');
const auth = require('./auth');
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
const mail = {};
mail.transporter = process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD
    ? nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD } })
    : null;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Begrenst uitgaande mail zodat de server geen mailrelay wordt. Elke soort mail heeft een eigen budget,
// zodat misbruik van de open "loting aanmaken" de herstelmail niet blokkeert.
// Per uur: 40 in totaal; aanmaakmail (open voor iedereen) krijgt daar maximaal 20 van, zodat de
// herstelmail altijd ruimte houdt. Per soort geldt verder 3 per adres en 5 per IP.
// ponytail: in het geheugen, werkt voor één serverinstantie.
const MAIL_KIND_CAP = { create: 20, recovery: 30, reset: 20 };
const sentMail = [];
function mailAllowed(kind, to, ip) {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (sentMail.length && sentMail[0].at < cutoff) sentMail.shift();
    const addr = to.toLowerCase();
    const ofKind = sentMail.filter(m => m.kind === kind);
    if (sentMail.length >= 40 || ofKind.length >= (MAIL_KIND_CAP[kind] ?? 0)) return false; // onbekende soort: geweigerd
    if (ofKind.filter(m => m.to === addr).length >= 3) return false;
    if (ip && ofKind.filter(m => m.ip === ip).length >= 5) return false;
    sentMail.push({ kind, to: addr, ip, at: Date.now() });
    return true;
}

async function sendMail(kind, to, subject, html, ip) {
    if (!mail.transporter || !mailAllowed(kind, to, ip)) return false;
    try {
        await mail.transporter.sendMail({ from: process.env.GMAIL_USER, to, subject, html });
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

// Onderwerp is vast. De mail gaat naar het adres van het ingelogde account en bevat alleen links.
function sendLotteryReadyEmail(email, eventName, eventUrl, ip) {
    const adminUrl = `${baseUrl()}/admin/${eventUrl}`;
    const participantUrl = `${baseUrl()}/event/${eventUrl}`;
    return sendMail('create', email, 'Je Sinterklaas Lootjes-loting staat klaar', mailFrame(`
        <h2>Je loting "${esc(eventName)}" staat klaar</h2>
        <p><strong>Beheerlink (alleen voor jou):</strong><br><a href="${esc(adminUrl)}">${esc(adminUrl)}</a></p>
        <p><strong>Link voor deelnemers:</strong><br><a href="${esc(participantUrl)}">${esc(participantUrl)}</a></p>
        <p style="color: #8a7a68;">Log in met je account om de loting te beheren.</p>`), ip);
}

function sendPasswordResetEmail(email, name, resetUrl) {
    return sendMail('reset', email, 'Kies je wachtwoord voor Sinterklaas Lootjes', mailFrame(`
        <h2>Kies je wachtwoord</h2>
        <p>${name ? `Hallo ${esc(name)}, met` : 'Met'} deze knop kies je een wachtwoord voor je account bij Sinterklaas Lootjes. De link werkt één uur.</p>
        <p><a href="${esc(resetUrl)}" style="display: inline-block; padding: 12px 22px; color: #fff; background: #b3202f; border-radius: 999px; text-decoration: none; font-weight: bold;">Kies een nieuw wachtwoord</a></p>
        <p style="color: #8a7a68;">Werkt de knop niet? Plak dan deze link in je browser:<br>${esc(resetUrl)}</p>
        <p style="color: #8a7a68;">Heb je dit niet aangevraagd? Dan hoef je niets te doen.</p>`));
}

function sendRecoveryEmail(email, eventName, recipientName, ip) {
    return sendMail('recovery', email, 'Je Sinterklaas lootje', mailFrame(`
        <h2>Je lootje van "${esc(eventName)}"</h2>
        <p>Jij mag een surprise maken voor:</p>
        <p style="font-size: 26px; font-weight: bold; color: #b11e2d;">${esc(recipientName)}</p>
        <p>Veel plezier met het uitzoeken van een cadeau!</p>`), ip);
}

// --- Middleware ---
app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.raw({ type: 'image/jpeg', limit: '1600kb' }));
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
const strict = rateLimit(Number(process.env.RATE_LIMIT_STRICT) || 30); // per minuut per IP; env alleen voor tests

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const fail = (res, status, message) => res.status(status).json({ success: false, message });

// --- Validatie ---
const cleanText = (v, max) => {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim();
    return t && t.length <= max ? t : null;
};
const isEmail = v => typeof v === 'string' && v.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const TOKEN_RE = /^[A-Za-z0-9._~-]{16,200}$/;
const isCode = v => typeof v === 'string' && /^[a-f0-9]{16}$/.test(v);

// --- Pagina's ---
const page = name => (req, res) => res.sendFile(path.join(__dirname, 'public', name));
app.get('/event/:eventUrl', page('index.html'));
app.get('/admin/:eventUrl', page('admin.html'));
app.get('/recovery/:recoveryUrl', page('recovery.html'));
app.get('/nieuw-wachtwoord', page('reset.html'));

io.on('connection', socket => {
    socket.on('join-event', code => isCode(code) && socket.join(`event:${code}`));
    socket.on('join-recovery', code => isCode(code) && socket.join(`recovery:${code}`));
});

// --- Inloggen ---
app.get('/auth/callback', page('admin.html'));
app.get('/api/auth/config', (req, res) => res.json(auth.clientConfig()));
app.get('/api/auth/me', (req, res) => {
    const user = auth.userFrom(req);
    res.json({ loggedIn: !!user, email: user ? user.email : null });
});

app.post('/api/auth/callback', strict, wrap(async (req, res) => {
    const { code, verifier } = req.body;
    if (typeof code !== 'string' || typeof verifier !== 'string' || code.length > 500 || verifier.length > 200) {
        return fail(res, 400, 'Ongeldige aanvraag');
    }
    const user = await auth.exchangeCode(code, verifier);
    if (!user) return fail(res, 401, 'Inloggen is niet gelukt. Probeer het nog eens.');
    auth.setSession(res, user);
    res.json({ success: true, email: user.email });
}));

app.post('/api/auth/logout', (req, res) => {
    auth.clearSession(res);
    res.json({ success: true });
});

// --- Admin (alleen voor de eigenaar van de loting) ---
const needUser = (req, res, next) => {
    const user = auth.userFrom(req);
    if (!user) return res.status(401).json({ success: false, needLogin: true, message: 'Log eerst in.' });
    req.user = user;
    next();
};

// Geeft de loting terug als de ingelogde gebruiker de eigenaar is; anders is het antwoord al verstuurd.
async function ownLottery(req, res, eventUrl) {
    const lottery = isCode(eventUrl) ? await store.getLottery(eventUrl) : null;
    if (!lottery) { fail(res, 404, 'Loting niet gevonden'); return null; }
    if (!store.isOwner(lottery, req.user.id)) {
        res.status(403).json({ success: false, claimable: store.isClaimable(lottery), message: 'Deze loting hoort bij een ander account.' });
        return null;
    }
    return lottery;
}

app.get('/api/admin/lotteries', needUser, wrap(async (req, res) => {
    res.json({ success: true, lotteries: await store.listLotteries(req.user.id) });
}));

app.get('/api/admin/lottery/:eventUrl', needUser, wrap(async (req, res) => {
    if (!(await ownLottery(req, res, req.params.eventUrl))) return;
    res.json({ success: true, ...(await store.getLotteryData(req.params.eventUrl)) });
}));

// Oude loting (van vóór accounts) koppelen aan het ingelogde account met de oude inloggegevens.
app.post('/api/admin/claim', needUser, strict, wrap(async (req, res) => {
    const { eventUrl, username, password } = req.body;
    if (!isCode(eventUrl) || typeof username !== 'string' || typeof password !== 'string') return fail(res, 400, 'Alle velden zijn verplicht');
    if (!(await store.claimLottery(eventUrl, req.user, username.trim(), password.trim()))) {
        return fail(res, 401, 'Deze gegevens kloppen niet, of de loting is al gekoppeld aan een account.');
    }
    res.json({ success: true });
}));

// Organisator van vóór de accounts: oude gegevens plus een e-mailadres worden een account en de loting wordt
// gekoppeld. Het wachtwoord kiest de gebruiker via de mail, dus wie het adres opgeeft moet er ook bij kunnen.
app.post('/api/admin/convert', strict, wrap(async (req, res) => {
    const { eventUrl, username, password, email, emailRepeat } = req.body;
    if (!isCode(eventUrl) || typeof username !== 'string' || typeof password !== 'string') return fail(res, 400, 'Alle velden zijn verplicht');
    const address = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!isEmail(address) || address !== String(emailRepeat || '').trim().toLowerCase()) {
        return fail(res, 400, 'Vul hetzelfde, geldige e-mailadres twee keer in');
    }
    const lottery = await store.checkLegacy(eventUrl, username.trim(), password.trim());
    if (!lottery) return fail(res, 401, 'Deze gegevens kloppen niet, of de loting is al gekoppeld aan een account.');

    let user;
    try {
        user = await auth.registerUser(address);
    } catch (err) {
        if (err.duplicate) return fail(res, 409, 'Er is al een account met dit e-mailadres. Log daarmee in en koppel de loting daarna.');
        throw err;
    }
    await store.assignOwner(lottery, user);

    let mailRequested = true;
    try {
        await auth.requestPasswordReset(address);
    } catch (err) {
        console.error('Resetmail aanvragen mislukt:', err.message);
        mailRequested = false;
    }
    res.json({ success: true, mailRequested, email: address });
}));

// Wachtwoord kiezen via de link uit de mail (token komt van Apenkaas via de webhook).
app.post('/api/auth/reset', strict, wrap(async (req, res) => {
    const { token, password } = req.body;
    if (typeof token !== 'string' || !TOKEN_RE.test(token) || typeof password !== 'string') return fail(res, 400, 'Ongeldige aanvraag');
    if (password.length < 8 || password.length > 200) return fail(res, 400, 'Kies een wachtwoord van minimaal 8 tekens');
    try {
        await auth.confirmPasswordReset(token, password);
    } catch (err) {
        if (err.status && err.status < 500) return fail(res, 400, 'Deze link is verlopen of al gebruikt. Kies "Wachtwoord vergeten" op de loginpagina voor een nieuwe.');
        throw err;
    }
    res.json({ success: true });
}));

// --- Uiterlijk van een loting ---
app.post('/api/admin/design', needUser, strict, wrap(async (req, res) => {
    const lottery = await ownLottery(req, res, req.body.eventUrl);
    if (!lottery) return;
    const { theme } = req.body;
    const welcome = typeof req.body.welcome === 'string' ? req.body.welcome.replace(/\s+/g, ' ').trim() : '';
    if (!store.THEMES.includes(theme)) return fail(res, 400, 'Onbekend kleurthema');
    if (welcome.length > 140) return fail(res, 400, 'De welkomsttekst mag maximaal 140 tekens zijn');
    await store.saveDesign(lottery, { theme, welcome });
    res.json({ success: true });
}));

// Body is een JPEG (de pagina verkleint de foto vooraf en haalt zo ook locatiegegevens uit de foto).
app.post('/api/admin/background', needUser, strict, wrap(async (req, res) => {
    const lottery = await ownLottery(req, res, req.query.eventUrl);
    if (!lottery) return;
    const jpeg = req.body;
    const isJpeg = Buffer.isBuffer(jpeg) && jpeg.length > 1000 && jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff;
    if (!isJpeg) return fail(res, 400, 'Kies een JPEG-foto van maximaal 1,5 MB.');
    const updated = await store.setBackground(lottery, jpeg);
    res.json({ success: true, backgroundUrl: store.designOf(updated).backgroundUrl });
}));

app.post('/api/admin/background/delete', needUser, strict, wrap(async (req, res) => {
    const lottery = await ownLottery(req, res, req.body.eventUrl);
    if (!lottery) return;
    await store.clearBackground(lottery);
    res.json({ success: true });
}));

app.post('/api/admin/create', needUser, strict, wrap(async (req, res) => {
    const { familyMode } = req.body;
    const eventName = cleanText(req.body.eventName, 80);
    if (!eventName) return fail(res, 400, 'Geef je loting een naam');

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
        eventName, owner: req.user, participants: names, families, familyMode: !!familyMode, assignments
    });
    const mailed = await sendLotteryReadyEmail(req.user.email, eventName, eventUrl, req.ip);

    res.json({
        success: true,
        message: mailed ? `Loting aangemaakt! De links staan ook in je mail (${req.user.email}).` : 'Loting aangemaakt!',
        eventUrl,
        adminUrl: `/admin/${eventUrl}`,
        participantUrl: `/event/${eventUrl}`
    });
}));

app.post('/api/admin/delete', needUser, strict, wrap(async (req, res) => {
    if (!(await ownLottery(req, res, req.body.eventUrl))) return;
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
app.post('/api/recovery/create', needUser, strict, wrap(async (req, res) => {
    if (!(await ownLottery(req, res, req.body.eventUrl))) return;
    if (!isEmail(req.body.recoveryEmail)) return fail(res, 400, 'Voer een geldig e-mailadres in');
    if (!mail.transporter) return fail(res, 503, 'E-mail is niet ingesteld op de server, herstel kan dus geen mail sturen.');

    const recoveryUrl = await store.createRecoverySession(req.body.eventUrl, req.body.recoveryEmail.trim());
    res.json({ success: true, recoveryUrl, fullUrl: `${baseUrl()}/recovery/${recoveryUrl}` });
}));

app.get('/api/recovery/:recoveryUrl', wrap(async (req, res) => {
    const session = isCode(req.params.recoveryUrl) && await store.getRecoverySession(req.params.recoveryUrl);
    if (!session) return fail(res, 404, 'Herstelsessie niet gevonden');
    // Geen klikgegevens teruggeven: wie wat aanklikte blijft geheim.
    res.json({
        success: true,
        eventName: session.eventName,
        design: session.design,
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

// --- Webhook van Apenkaas: wachtwoord vergeten ---
// Apenkaas heeft geen eigen e-mail; het meldt de aanvraag hier en wij sturen de mail.
// Een niet-2xx antwoord laat Apenkaas het later opnieuw proberen (max. 6 keer).
const sameSignature = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

app.post('/api/webhooks/apenkaas', wrap(async (req, res) => {
    const secret = process.env.APENKAAS_WEBHOOK_SECRET;
    if (!secret) return fail(res, 503, 'Webhook is niet ingesteld');
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody || '').digest('hex');
    if (!sameSignature(String(req.get('X-Apenkaas-Signature') || ''), expected)) return fail(res, 401, 'Ongeldige handtekening');

    const { event, tenant_id: tenant, data } = req.body || {};
    if (tenant !== process.env.APENKAAS_TENANT) return fail(res, 400, 'Onbekende tenant');
    if (event !== 'user.password_reset_requested') return res.json({ success: true, ignored: true });

    if (!data || !isEmail(data.email)) return fail(res, 400, 'Ongeldige melding');
    // Via de loginpagina komt een resetlink van Apenkaas mee; bij een aanvraag via de API alleen een token,
    // dan verwijzen we naar onze eigen pagina. Ook een ondertekende resetlink moet naar Apenkaas wijzen.
    let link;
    if (data.reset_url) {
        let url;
        try { url = new URL(data.reset_url); } catch { return fail(res, 400, 'Ongeldige resetlink'); }
        if (url.origin !== new URL(process.env.APENKAAS_URL || 'https://apenkaas.nl').origin) return fail(res, 400, 'Ongeldige melding');
        link = url.href;
    } else if (typeof data.token === 'string' && TOKEN_RE.test(data.token)) {
        link = `${baseUrl()}/nieuw-wachtwoord?token=${encodeURIComponent(data.token)}`;
    } else {
        return fail(res, 400, 'Ongeldige melding');
    }

    const name = typeof data.naam === 'string' ? data.naam.slice(0, 80) : '';
    if (!(await sendPasswordResetEmail(data.email.trim(), name, link))) return fail(res, 503, 'De e-mail kon niet worden verstuurd');
    res.json({ success: true });
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
    auth.assertConfigured();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Sinterklaas Lootjes draait op http://0.0.0.0:${PORT} (backend: Apenkaas)`);
        console.log(mail.transporter ? 'E-mail ingesteld' : 'E-mail niet ingesteld: herstel-mails en inlogmails staan uit');
    });
}

module.exports = { app, server, mail };
