// Inloggen via de gehoste loginpagina van Apenkaas (authorization code + PKCE).
// De browser start de login; hier wisselen we de code in en zetten een eigen, getekende sessiecookie.
// We bewaren geen Apenkaas-tokens: we hebben alleen het account-id en e-mailadres nodig.
const crypto = require('crypto');

const COOKIE = 'lootjes_sessie';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

const cfg = () => ({
    url: (process.env.APENKAAS_URL || 'https://apenkaas.nl').replace(/\/$/, ''),
    tenant: process.env.APENKAAS_TENANT,
    appId: process.env.APENKAAS_APP_ID,
    secret: process.env.SESSION_SECRET,
    base: (process.env.BASE_URL || '').replace(/\/$/, '')
});

function assertConfigured() {
    const c = cfg();
    const missing = [];
    if (!c.appId) missing.push('APENKAAS_APP_ID');
    if (!c.secret || c.secret.length < 32) missing.push('SESSION_SECRET (minimaal 32 tekens)');
    if (!c.base) missing.push('BASE_URL');
    if (missing.length) throw new Error(`Inloggen niet ingesteld, ontbreekt: ${missing.join(', ')} (zie .env.example)`);
}

const b64 = buf => Buffer.from(buf).toString('base64url');
const mac = body => b64(crypto.createHmac('sha256', cfg().secret).update(body).digest());

function sign(payload) {
    const body = b64(JSON.stringify(payload));
    return `${body}.${mac(body)}`;
}

function verify(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(mac(body));
    const actual = Buffer.from(sig);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        return payload.exp > Date.now() / 1000 ? payload : null;
    } catch {
        return null;
    }
}

function readCookie(req, name) {
    for (const part of String(req.headers.cookie || '').split(';')) {
        const [k, ...v] = part.trim().split('=');
        if (k === name) return v.join('=');
    }
    return null;
}

// Korte, getekende tokens voor een doel (bijvoorbeeld "bewaar je lootje"). null als ze niet kloppen of verlopen zijn.
const signToken = (payload, ttlSeconds) => sign({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds });
const verifyToken = (token, purpose) => {
    const payload = verify(token);
    return payload && payload.p === purpose ? payload : null;
};

// { id, email } of null
function userFrom(req) {
    const payload = verify(readCookie(req, COOKIE));
    return payload ? { id: payload.uid, email: payload.email } : null;
}

const cookieFlags = () => `HttpOnly; SameSite=Lax; Path=/${cfg().base.startsWith('https') ? '; Secure' : ''}`;

function setSession(res, user, seconds = SESSION_SECONDS) {
    const token = sign({ uid: user.id, email: user.email, exp: Math.floor(Date.now() / 1000) + seconds });
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Max-Age=${seconds}; ${cookieFlags()}`);
}

const clearSession = res => res.setHeader('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags()}`);

// Gegevens voor de browser om de login te starten. De redirect-URI bepaalt de server, niet de client.
function clientConfig() {
    const c = cfg();
    return { loginUrl: `${c.url}/login/${c.tenant}/${c.appId}`, redirectUri: `${c.base}/auth/callback` };
}

// Wisselt de eenmalige code in voor de gebruiker; null als Apenkaas de code weigert.
async function exchangeCode(code, verifier) {
    const c = cfg();
    const res = await fetch(`${c.url}/api/${c.tenant}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: c.appId, code, code_verifier: verifier, redirect_uri: clientConfig().redirectUri }),
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const { user, refreshToken } = await res.json();
    if (!user || !user.id || !user.email) return null;
    // We gebruiken de Apenkaas-tokens niet verder: meteen intrekken.
    if (refreshToken) {
        fetch(`${c.url}/api/${c.tenant}/logout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
            signal: AbortSignal.timeout(5000)
        }).catch(() => {});
    }
    return { id: user.id, email: user.email, naam: user.naam || null };
}

// Publieke Apenkaas-routes van de tenant (geen sleutel nodig).
async function tenantPost(path, body) {
    const c = cfg();
    const res = await fetch(`${c.url}/api/${c.tenant}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(json.message || `Apenkaas fout ${res.status}`), { status: res.status });
    return json;
}

// Maakt een account. Zonder wachtwoord wordt het een willekeurig wachtwoord; de gebruiker kiest zelf een wachtwoord
// via de resetmail. Gooit een fout met duplicate = true als het e-mailadres al een account heeft.
async function registerUser(email, password = crypto.randomBytes(24).toString('base64url')) {
    try {
        const user = await tenantPost('/register', { email, password });
        return { id: user.id, email: user.email };
    } catch (err) {
        err.duplicate = /al in gebruik/i.test(err.message);
        throw err;
    }
}

// Apenkaas meldt dit via de webhook aan de loottool, die de mail met de link verstuurt.
const requestPasswordReset = email => tenantPost('/password-reset/request', { email });
const confirmPasswordReset = (token, newPassword) => tenantPost('/password-reset/confirm', { token, newPassword });

module.exports = {
    assertConfigured, signToken, verifyToken, userFrom, setSession, clearSession, clientConfig, exchangeCode,
    registerUser, requestPasswordReset, confirmPasswordReset
};
