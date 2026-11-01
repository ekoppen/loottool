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
