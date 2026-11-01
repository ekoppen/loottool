// Verdeelt wie wie trekt. Niemand trekt zichzelf; in gezinsmodus ook geen gezinsgenoot.
function shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function createAssignments(names, families, familyMode, maxAttempts = 1000) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = {};
        let available = [...names];
        let ok = true;

        for (const giver of shuffle(names)) {
            const valid = available.filter(r => r !== giver && !(familyMode && families[giver] === families[r]));
            if (valid.length === 0) { ok = false; break; }
            const receiver = valid[Math.floor(Math.random() * valid.length)];
            result[giver] = receiver;
            available = available.filter(r => r !== receiver);
        }
        if (ok) return result;
    }
    return null;
}

module.exports = { createAssignments };
