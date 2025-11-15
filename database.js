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

        CREATE TABLE IF NOT EXISTS recovery_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recovery_url TEXT UNIQUE NOT NULL,
            lottery_id INTEGER NOT NULL,
            recovery_email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            email_sent INTEGER DEFAULT 0,
            email_sent_at TEXT,
            FOREIGN KEY (lottery_id) REFERENCES lottery(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS recovery_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recovery_session_id INTEGER NOT NULL,
            clicked_recipient_name TEXT NOT NULL,
            clicked_at TEXT NOT NULL,
            FOREIGN KEY (recovery_session_id) REFERENCES recovery_sessions(id) ON DELETE CASCADE,
            UNIQUE(recovery_session_id, clicked_recipient_name)
        );

        CREATE INDEX IF NOT EXISTS idx_lottery_event_url ON lottery(event_url);
        CREATE INDEX IF NOT EXISTS idx_lottery_active ON lottery(active);
        CREATE INDEX IF NOT EXISTS idx_participants_lottery ON participants(lottery_id);
        CREATE INDEX IF NOT EXISTS idx_participants_viewed ON participants(viewed);
        CREATE INDEX IF NOT EXISTS idx_recovery_sessions_url ON recovery_sessions(recovery_url);
        CREATE INDEX IF NOT EXISTS idx_recovery_clicks_session ON recovery_clicks(recovery_session_id);
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

// Recovery functions

// Create recovery session
function createRecoverySession(eventUrl, recoveryEmail) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return null;
    }

    const recoveryUrl = crypto.randomBytes(8).toString('hex');
    const createdAt = new Date().toISOString();

    const insert = db.prepare(`
        INSERT INTO recovery_sessions (recovery_url, lottery_id, recovery_email, created_at)
        VALUES (?, ?, ?, ?)
    `);

    insert.run(recoveryUrl, lottery.id, recoveryEmail, createdAt);

    return recoveryUrl;
}

// Get recovery session
function getRecoverySession(recoveryUrl) {
    const session = db.prepare(`
        SELECT rs.*, l.event_name, l.event_url
        FROM recovery_sessions rs
        JOIN lottery l ON rs.lottery_id = l.id
        WHERE rs.recovery_url = ?
    `).get(recoveryUrl);

    if (!session) {
        return null;
    }

    // Get all participants for this lottery
    const participants = getParticipants(session.lottery_id);

    // Get all clicked names
    const clicks = db.prepare(`
        SELECT clicked_recipient_name
        FROM recovery_clicks
        WHERE recovery_session_id = ?
    `).all(session.id);

    const clickedNames = clicks.map(c => c.clicked_recipient_name);

    return {
        sessionId: session.id,
        eventName: session.event_name,
        eventUrl: session.event_url,
        recoveryEmail: session.recovery_email,
        participants: participants.map(p => p.name),
        clickedNames: clickedNames,
        totalParticipants: participants.length,
        clickCount: clickedNames.length,
        emailSent: session.email_sent === 1
    };
}

// Register a click on a recipient name
function registerRecoveryClick(recoveryUrl, recipientName) {
    const session = getRecoverySession(recoveryUrl);

    if (!session) {
        return { success: false, error: 'Recovery sessie niet gevonden' };
    }

    if (session.emailSent) {
        return { success: false, error: 'Recovery is al afgerond' };
    }

    // Check if this name exists in participants
    if (!session.participants.includes(recipientName)) {
        return { success: false, error: 'Naam niet gevonden' };
    }

    // Check if already clicked
    if (session.clickedNames.includes(recipientName)) {
        return { success: false, error: 'Deze naam is al aangeklikt' };
    }

    const clickedAt = new Date().toISOString();

    try {
        db.prepare(`
            INSERT INTO recovery_clicks (recovery_session_id, clicked_recipient_name, clicked_at)
            VALUES (?, ?, ?)
        `).run(session.sessionId, recipientName, clickedAt);

        const newClickCount = session.clickCount + 1;
        const totalParticipants = session.totalParticipants;

        // Check if we have N-1 clicks (only one person left)
        if (newClickCount === totalParticipants - 1) {
            // Find the missing name
            const missingName = session.participants.find(name => !session.clickedNames.includes(name) && name !== recipientName);

            return {
                success: true,
                clickCount: newClickCount,
                totalParticipants: totalParticipants,
                shouldSendEmail: true,
                missingName: missingName,
                recoveryEmail: session.recoveryEmail,
                sessionId: session.sessionId
            };
        }

        return {
            success: true,
            clickCount: newClickCount,
            totalParticipants: totalParticipants,
            shouldSendEmail: false
        };
    } catch (error) {
        return { success: false, error: 'Database fout: ' + error.message };
    }
}

// Mark recovery email as sent
function markRecoveryEmailSent(sessionId) {
    const emailSentAt = new Date().toISOString();

    db.prepare(`
        UPDATE recovery_sessions
        SET email_sent = 1, email_sent_at = ?
        WHERE id = ?
    `).run(emailSentAt, sessionId);
}

// Get recovery sessions for an event (for admin)
function getRecoverySessionsForEvent(eventUrl) {
    const lottery = getActiveLottery(eventUrl);

    if (!lottery) {
        return [];
    }

    const sessions = db.prepare(`
        SELECT recovery_url, recovery_email, created_at, email_sent
        FROM recovery_sessions
        WHERE lottery_id = ?
        ORDER BY created_at DESC
    `).all(lottery.id);

    return sessions.map(session => {
        const clicks = db.prepare(`
            SELECT COUNT(*) as count
            FROM recovery_clicks
            WHERE recovery_session_id = (
                SELECT id FROM recovery_sessions WHERE recovery_url = ?
            )
        `).get(session.recovery_url);

        return {
            ...session,
            clickCount: clicks.count
        };
    });
}

module.exports = {
    db,
    getLotteryData,
    createLottery,
    markAsViewed,
    getAssignment,
    deleteLottery,
    getLotteryStatus,
    verifyAdmin,
    createRecoverySession,
    getRecoverySession,
    registerRecoveryClick,
    markRecoveryEmailSent,
    getRecoverySessionsForEvent
};
