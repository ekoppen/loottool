// Gedeelde helpers voor alle pagina's.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = id => document.getElementById(id);

// Roept de API aan en geeft altijd { success, message, ... } terug, ook bij netwerkfouten.
async function api(path, body) {
    try {
        const res = await fetch(path, body === undefined ? undefined : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        return await res.json();
    } catch {
        return { success: false, message: 'Geen verbinding met de server. Probeer het nog eens.' };
    }
}

function toast(title, message = '', type = 'info') {
    let box = $('toasts');
    if (!box) {
        box = document.createElement('div');
        box.id = 'toasts';
        box.className = 'toasts';
        box.setAttribute('role', 'status');
        document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<strong>${esc(title)}</strong>${message ? `<span>${esc(message)}</span>` : ''}`;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4200);
}

// Bevestigingsvenster met het ingebouwde <dialog>: Escape en focus werken vanzelf.
function askConfirm(title, text, okLabel = 'Bevestigen', danger = false) {
    return new Promise(resolve => {
        const dlg = document.createElement('dialog');
        dlg.innerHTML = `
            <form method="dialog">
                <h2>${esc(title)}</h2>
                <p>${esc(text)}</p>
                <div class="dialog-actions">
                    <button class="btn btn-ghost" value="cancel">Annuleren</button>
                    <button class="btn ${danger ? 'btn-danger' : ''}" value="ok" autofocus>${esc(okLabel)}</button>
                </div>
            </form>`;
        dlg.addEventListener('close', () => { resolve(dlg.returnValue === 'ok'); dlg.remove(); });
        document.body.appendChild(dlg);
        dlg.showModal();
    });
}

async function copyText(text, okMessage = 'Link gekopieerd') {
    try {
        await navigator.clipboard.writeText(text);
        toast(okMessage, '', 'success');
    } catch {
        toast('Kopiëren lukte niet', 'Selecteer de link en kopieer hem zelf.', 'error');
    }
}

// Live-updates: meldt je aan bij een kamer en koppelt de handlers.
function joinRoom(joinEvent, code, handlers) {
    if (typeof io === 'undefined' || !code) return;
    const socket = io();
    socket.on('connect', () => socket.emit(joinEvent, code));
    Object.entries(handlers).forEach(([event, fn]) => socket.on(event, fn));
    return socket;
}

// Toont één scherm uit een groep (.screen) en verbergt de rest.
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    $(id).classList.remove('hidden');
}

// Past het uiterlijk van een loting toe: kleurthema, welkomsttekst en achtergrondfoto. null = standaard.
function applyDesign(design) {
    const d = design || {};
    document.body.dataset.theme = d.theme || 'sint';
    const photo = d.backgroundUrl && /^https?:\/\//.test(d.backgroundUrl) ? d.backgroundUrl : null;
    document.body.classList.toggle('has-photo', !!photo);
    document.body.style.setProperty('--photo', photo ? `url("${encodeURI(photo)}")` : 'none');
}

// --- Inloggen met Apenkaas (authorization code met PKCE), gedeeld door beheer en "Mijn lootjes" ---
const LOGIN_STORAGE_KEY = 'lootjes-login';
const CLAIM_STORAGE_KEY = 'lootjes-claim'; // claim-token van een lootje dat na het inloggen gekoppeld moet worden
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

// Stuurt door naar de loginpagina; na het inloggen komt de gebruiker terug op returnTo.
async function startLogin(returnTo) {
    const cfg = await api('/api/auth/config');
    if (!cfg.loginUrl) return toast('Inloggen is nog niet ingesteld', '', 'error');
    const verifier = randomString(48);
    const state = randomString(16);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    try { sessionStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify({ verifier, state, returnTo })); } catch { return toast('Inloggen lukt niet in deze browser', 'Zet cookies en site-opslag aan.', 'error'); }
    location.href = `${cfg.loginUrl}?redirect_uri=${encodeURIComponent(cfg.redirectUri)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
}

// Terug van de loginpagina op /auth/callback: code inwisselen. Geeft het pad terug waar de gebruiker heen moet.
async function finishLogin() {
    const params = new URLSearchParams(location.search);
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(LOGIN_STORAGE_KEY)); sessionStorage.removeItem(LOGIN_STORAGE_KEY); } catch { /* geen opslag */ }
    let target = '/admin.html';
    if (saved && params.get('state') === saved.state && params.get('code')) {
        const data = await api('/api/auth/callback', { code: params.get('code'), verifier: saved.verifier });
        if (data.success) target = saved.returnTo || target;
        else toast('Inloggen mislukt', data.message, 'error');
    } else {
        toast('Inloggen mislukt', 'De inlogpoging klopte niet meer. Probeer het nog eens.', 'error');
    }
    history.replaceState({}, '', target);
    return target;
}
