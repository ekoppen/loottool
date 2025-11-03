const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = process.env.PORT || 3000;

// Email transporter setup
let emailTransporter = null;
try {
    if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        emailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD
            }
        });
        console.log('📧 Email service configured');
    } else {
        console.log('⚠️  Email service not configured (missing GMAIL_USER or GMAIL_APP_PASSWORD)');
    }
} catch (error) {
    console.error('Error setting up email transporter:', error);
    emailTransporter = null;
}

// Function to send admin credentials email
async function sendAdminCredentialsEmail(email, eventName, eventUrl, username, password) {
    if (!emailTransporter) {
        console.log('Email not sent - transporter not configured');
        return false;
    }

    const adminUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/admin/${eventUrl}`;
    const participantUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/event/${eventUrl}`;

    const mailOptions = {
        from: process.env.GMAIL_USER,
        to: email,
        subject: `Je Sinterklaas Lootjes - ${eventName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h1 style="color: #c41e3a;">🎁 Sinterklaas Lootjes</h1>
                <h2>Je loting is aangemaakt!</h2>
                <p>Beste organisator,</p>
                <p>Je loting "<strong>${eventName}</strong>" is succesvol aangemaakt. Hier zijn je inloggegevens:</p>

                <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Admin Gegevens</h3>
                    <p><strong>Gebruikersnaam:</strong> ${username}</p>
                    <p><strong>Wachtwoord:</strong> ${password}</p>
                    <p><strong>Admin URL:</strong><br><a href="${adminUrl}">${adminUrl}</a></p>
                </div>

                <div style="background: #e8f5e9; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin-top: 0;">Deelnemers Link</h3>
                    <p>Deel deze link met je deelnemers:</p>
                    <p><a href="${participantUrl}">${participantUrl}</a></p>
                </div>

                <p style="color: #666; font-size: 14px;">
                    <strong>⚠️ Belangrijk:</strong> Bewaar deze email goed. Je hebt deze gegevens nodig om je loting te beheren.
                </p>

                <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0;">
                <p style="color: #999; font-size: 12px;">
                    Dit is een automatisch gegenereerde email van Sinterklaas Lootjes.
                </p>
            </div>
        `
    };

    try {
        await emailTransporter.sendMail(mailOptions);
        console.log(`📧 Email sent to ${email} for event ${eventUrl}`);
        return true;
    } catch (error) {
        console.error('Failed to send email:', error);
        return false;
    }
}

app.use(bodyParser.json());
app.use(express.static('public'));

// Route for event URLs - serve the main index.html
app.get('/event/:eventUrl', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route for admin URLs - serve admin.html with event context
app.get('/admin/:eventUrl', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Join event room
    socket.on('join-event', (eventUrl) => {
        socket.join(`event:${eventUrl}`);
        console.log(`Socket ${socket.id} joined event: ${eventUrl}`);
    });

    // Join admin room
    socket.on('join-admin', () => {
        socket.join('admin');
        console.log(`Socket ${socket.id} joined admin room`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Admin: Login to specific event
app.post('/api/admin/login', (req, res) => {
    const { eventUrl, username, password } = req.body;

    if (!eventUrl || !username || !password) {
        return res.status(400).json({ success: false, message: 'Alle velden zijn verplicht' });
    }

    const isValid = db.verifyAdmin(eventUrl, username, password);

    if (isValid) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Ongeldige inloggegevens' });
    }
});

// Admin: Get configuration for specific event
app.get('/api/admin/config', async (req, res) => {
    const { eventUrl } = req.query;

    if (!eventUrl) {
        return res.json({
            participants: [],
            families: {},
            familyMode: false,
            viewedBy: [],
            eventUrl: null,
            eventName: null
        });
    }

    const lottery = db.getLotteryData(eventUrl);

    if (lottery) {
        res.json({
            eventName: lottery.eventName,
            participants: lottery.participants,
            families: lottery.families,
            familyMode: lottery.familyMode,
            created: lottery.created,
            viewedBy: lottery.viewedBy,
            eventUrl: lottery.eventUrl
        });
    } else {
        res.json({
            participants: [],
            families: {},
            familyMode: false,
            viewedBy: [],
            eventUrl: null,
            eventName: null
        });
    }
});

// Admin: Create new lottery
app.post('/api/admin/create', async (req, res) => {
    const { eventName, adminUsername, adminPassword, adminEmail, participants, families, familyMode } = req.body;

    // Validation
    if (!eventName || !adminUsername || !adminPassword) {
        return res.status(400).json({ success: false, message: 'Event naam, gebruikersnaam en wachtwoord zijn verplicht' });
    }

    if (!participants || participants.length < 3) {
        return res.status(400).json({ success: false, message: 'Minimaal 3 deelnemers nodig' });
    }

    // Create assignments
    const assignments = createAssignments(participants, families, familyMode);

    if (!assignments) {
        return res.status(400).json({
            success: false,
            message: 'Kon geen geldige verdeling maken. Controleer gezinsverdeling.'
        });
    }

    // Create lottery in database
    const eventUrl = db.createLottery(eventName, adminUsername, adminPassword, participants, families, familyMode, assignments);

    // Send email if provided
    if (adminEmail && adminEmail.trim()) {
        try {
            await sendAdminCredentialsEmail(adminEmail, eventName, eventUrl, adminUsername, adminPassword);
        } catch (error) {
            console.error('Failed to send admin email:', error);
            // Don't fail the request if email fails
        }
    }

    // Notify all admin clients for this event
    io.to(`event:${eventUrl}`).emit('lottery-created', { eventUrl });

    res.json({
        success: true,
        message: adminEmail ? 'Loting succesvol aangemaakt! Check je email voor de inloggegevens.' : 'Loting succesvol aangemaakt!',
        eventUrl,
        adminUrl: `/admin/${eventUrl}`,
        participantUrl: `/event/${eventUrl}`
    });
});

// Admin: Delete lottery
app.post('/api/admin/delete', async (req, res) => {
    const { eventUrl, username, password } = req.body;

    if (!eventUrl || !username || !password) {
        return res.status(400).json({ success: false, message: 'Alle velden zijn verplicht' });
    }

    const success = db.deleteLottery(eventUrl, username, password);

    if (success) {
        // Notify all clients of this event
        io.to(`event:${eventUrl}`).emit('lottery-reset');

        res.json({ success: true, message: 'Loting verwijderd' });
    } else {
        res.status(401).json({ success: false, message: 'Ongeldige inloggegevens' });
    }
});

// Participant: Get their assignment
app.post('/api/draw', async (req, res) => {
    const { name, eventUrl } = req.body;

    if (!name || name.trim() === '') {
        return res.status(400).json({ success: false, message: 'Voer je naam in' });
    }

    const trimmedName = name.trim();

    // Get assignment
    const assignment = db.getAssignment(trimmedName, eventUrl);

    if (!assignment) {
        // Check if lottery exists
        const status = db.getLotteryStatus(eventUrl);
        if (!status.exists) {
            return res.status(404).json({
                success: false,
                message: 'Er is nog geen loting aangemaakt. Neem contact op met de organisator.'
            });
        }

        // Lottery exists but name not found
        return res.status(404).json({
            success: false,
            message: 'Deze naam staat niet in de lijst. Controleer de spelling.'
        });
    }

    // Mark as viewed
    const wasUpdated = db.markAsViewed(assignment.giver, eventUrl);

    // Broadcast update to all clients in this event
    if (wasUpdated) {
        const status = db.getLotteryStatus(eventUrl);
        io.to(`event:${eventUrl}`).emit('participant-viewed', {
            name: assignment.giver,
            viewedBy: status.viewedBy,
            viewedCount: status.viewedCount
        });

        // Also notify admin
        io.to('admin').emit('participant-viewed', {
            name: assignment.giver,
            viewedBy: status.viewedBy,
            viewedCount: status.viewedCount
        });
    }

    res.json({
        success: true,
        giver: assignment.giver,
        recipient: assignment.recipient,
        family: assignment.family
    });
});

// Participant: Check if lottery exists (with optional event URL)
app.get('/api/status', async (req, res) => {
    const eventUrl = req.query.eventUrl;
    const status = db.getLotteryStatus(eventUrl);
    res.json(status);
});

// Create assignments algorithm
function createAssignments(names, families, familyMode) {
    let attempts = 0;
    const maxAttempts = 1000;

    while (attempts < maxAttempts) {
        let result = {};
        let availableReceivers = [...names];
        let success = true;

        // Shuffle names for randomness
        let shuffledGivers = [...names].sort(() => Math.random() - 0.5);

        for (let giver of shuffledGivers) {
            // Filter available receivers
            let validReceivers = availableReceivers.filter(receiver => {
                // Can't give to yourself
                if (receiver === giver) return false;

                // In family mode, can't give to same family
                if (familyMode && families[giver] === families[receiver]) {
                    return false;
                }

                return true;
            });

            if (validReceivers.length === 0) {
                success = false;
                break;
            }

            // Pick random valid receiver
            let receiver = validReceivers[Math.floor(Math.random() * validReceivers.length)];
            result[giver] = receiver;

            // Remove receiver from available pool
            availableReceivers = availableReceivers.filter(r => r !== receiver);
        }

        if (success && Object.keys(result).length === names.length) {
            return result;
        }

        attempts++;
    }

    return null;
}

// Start server
server.listen(PORT, () => {
    console.log(`🎅 Sinterklaas Lootjes Server draait op http://localhost:${PORT}`);
    console.log(`🔧 Admin interface: http://localhost:${PORT}/admin.html`);
    console.log(`🎁 Deelnemers interface: http://localhost:${PORT}`);
    console.log(`🔌 WebSocket server actief`);
    console.log(`✨ Multi-tenant: elke loting heeft eigen admin credentials`);
});
