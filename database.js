const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data', 'lottery.db');
const db = new Database(DB_FILE);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Initialize database schema
function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lottery (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_url TEXT UNIQUE NOT NULL,
            event_name TEXT NOT NULL,
            admin_username TEXT NOT NULL,
            admin_password TEXT NOT NULL,
            family_mode INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            active INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lottery_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            family TEXT,
            recipient TEXT NOT NULL,
            viewed INTEGER DEFAULT 0,
            viewed_at TEXT,
            FOREIGN KEY (lottery_id) REFERENCES lottery(id) ON DELETE CASCADE,
            UNIQUE(lottery_id, name)
        );

        CREATE INDEX IF NOT EXISTS idx_lottery_event_url ON lottery(event_url);
        CREATE INDEX IF NOT EXISTS idx_lottery_active ON lottery(active);
        CREATE INDEX IF NOT EXISTS idx_participants_lottery ON participants(lottery_id);
        CREATE INDEX IF NOT EXISTS idx_participants_viewed ON participants(viewed);
    `);
}

initializeDatabase();

// Get active lottery
function getActiveLottery(eventUrl = null) {
    let query = 'SELECT * FROM lottery WHERE active = 1';
    const params = [];

    if (eventUrl) {
        query += ' AND event_url = ?';
        params.push(eventUrl);
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    return db.prepare(query).get(...params);
}

// Get participants for a lottery
function getParticipants(lotteryId) {
    return db.prepare(`
        SELECT name, family, recipient, viewed, viewed_at
        FROM participants
        WHERE lottery_id = ?
        ORDER BY name
    `).all(lotteryId);
}

// Get full lottery data
function getLotteryData(eventUrl = null) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return null;
    }

    const participants = getParticipants(lottery.id);

    const participantNames = participants.map(p => p.name);
    const viewedBy = participants.filter(p => p.viewed).map(p => p.name);
    const assignments = {};
    const families = {};

    participants.forEach(p => {
        assignments[p.name] = p.recipient;
        if (p.family) {
            families[p.name] = p.family;
        }
    });

    return {
        eventName: lottery.event_name,
        participants: participantNames,
        families: families,
        familyMode: lottery.family_mode === 1,
        assignments: assignments,
        created: lottery.created_at,
        viewedBy: viewedBy,
        eventUrl: lottery.event_url
    };
}

// Create new lottery
function createLottery(eventName, adminUsername, adminPassword, participants, families, familyMode, assignments) {
    const eventUrl = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();

    // Insert new lottery (don't deactivate old ones - multi-tenant!)
    const insertLottery = db.prepare(`
        INSERT INTO lottery (event_url, event_name, admin_username, admin_password, family_mode, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `);

    const result = insertLottery.run(eventUrl, eventName, adminUsername, adminPassword, familyMode ? 1 : 0, createdAt);
    const lotteryId = result.lastInsertRowid;

    // Insert participants
    const insertParticipant = db.prepare(`
        INSERT INTO participants (lottery_id, name, family, recipient, viewed)
        VALUES (?, ?, ?, ?, 0)
    `);

    const insertMany = db.transaction((participants) => {
        for (const name of participants) {
            const family = families[name] || null;
            const recipient = assignments[name];
            insertParticipant.run(lotteryId, name, family, recipient);
        }
    });

    insertMany(participants);

    return eventUrl;
}

// Verify admin credentials for an event
function verifyAdmin(eventUrl, username, password) {
    const lottery = db.prepare(`
        SELECT id FROM lottery
        WHERE event_url = ? AND admin_username = ? AND admin_password = ? AND active = 1
    `).get(eventUrl, username, password);

    return !!lottery;
}

// Delete specific lottery by event URL and admin credentials
function deleteLottery(eventUrl, username, password) {
    // First verify credentials
    if (!verifyAdmin(eventUrl, username, password)) {
        return false;
    }

    // Get lottery ID
    const lottery = db.prepare('SELECT id FROM lottery WHERE event_url = ?').get(eventUrl);

    if (!lottery) {
        return false;
    }

    // Delete participants first (foreign key constraint)
    db.prepare('DELETE FROM participants WHERE lottery_id = ?').run(lottery.id);

    // Delete lottery
    db.prepare('DELETE FROM lottery WHERE id = ?').run(lottery.id);

    return true;
}

// Mark participant as viewed
function markAsViewed(name, eventUrl = null) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return false;
    }

    const viewedAt = new Date().toISOString();

    const result = db.prepare(`
        UPDATE participants
        SET viewed = 1, viewed_at = ?
        WHERE lottery_id = ? AND name = ? AND viewed = 0
    `).run(viewedAt, lottery.id, name);

    return result.changes > 0;
}

// Get assignment for participant
function getAssignment(name, eventUrl = null) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return null;
    }

    // Case-insensitive search
    const participant = db.prepare(`
        SELECT name, family, recipient
        FROM participants
        WHERE lottery_id = ? AND LOWER(name) = LOWER(?)
    `).get(lottery.id, name);

    if (!participant) {
        return null;
    }

    return {
        giver: participant.name,
        recipient: participant.recipient,
        family: participant.family
    };
}

// Get lottery status
function getLotteryStatus(eventUrl = null) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return {
            exists: false,
            participantCount: 0,
            viewedCount: 0,
            participants: [],
            viewedBy: []
        };
    }

    const participants = getParticipants(lottery.id);
    const viewedBy = participants.filter(p => p.viewed).map(p => p.name);

    return {
        exists: true,
        participantCount: participants.length,
        viewedCount: viewedBy.length,
        participants: participants.map(p => p.name),
        viewedBy: viewedBy,
        eventUrl: lottery.event_url,
        eventName: lottery.event_name
    };
}

module.exports = {
    db,
    getLotteryData,
    createLottery,
    markAsViewed,
    getAssignment,
    deleteLottery,
    getLotteryStatus,
    verifyAdmin
};
