const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'sinterklaas2024';
const DATA_FILE = path.join(__dirname, 'data', 'lottery.json');

app.use(bodyParser.json());
app.use(express.static('public'));

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
    } catch (err) {
        console.error('Error creating data directory:', err);
    }
}

// Load lottery data
async function loadLottery() {
    try {
        const data = await fs.readFile(DATA_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return null;
    }
}

// Save lottery data
async function saveLottery(data) {
    await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

// Admin: Check password
app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Incorrect password' });
    }
});

// Admin: Get current configuration
app.get('/api/admin/config', async (req, res) => {
    const lottery = await loadLottery();
    if (lottery) {
        res.json({
            participants: lottery.participants,
            families: lottery.families,
            familyMode: lottery.familyMode,
            created: lottery.created,
            viewedBy: lottery.viewedBy || []
        });
    } else {
        res.json({ participants: [], families: {}, familyMode: false, viewedBy: [] });
    }
});

// Admin: Create new lottery
app.post('/api/admin/create', async (req, res) => {
    const { password, participants, families, familyMode } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Incorrect password' });
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
    
    const lottery = {
        participants,
        families,
        familyMode,
        assignments,
        created: new Date().toISOString(),
        viewedBy: []
    };
    
    await saveLottery(lottery);
    
    res.json({ success: true, message: 'Loting succesvol aangemaakt!' });
});

// Admin: Reset lottery
app.post('/api/admin/reset', async (req, res) => {
    const { password } = req.body;
    
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Incorrect password' });
    }
    
    try {
        await fs.unlink(DATA_FILE);
        res.json({ success: true, message: 'Loting verwijderd' });
    } catch (err) {
        res.json({ success: true, message: 'Geen loting om te verwijderen' });
    }
});

// Participant: Get their assignment
app.post('/api/draw', async (req, res) => {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ success: false, message: 'Voer je naam in' });
    }
    
    const lottery = await loadLottery();
    
    if (!lottery) {
        return res.status(404).json({ 
            success: false, 
            message: 'Er is nog geen loting aangemaakt. Neem contact op met de organisator.' 
        });
    }
    
    const trimmedName = name.trim();
    
    if (!lottery.participants.includes(trimmedName)) {
        return res.status(404).json({ 
            success: false, 
            message: 'Deze naam staat niet in de lijst. Controleer de spelling.' 
        });
    }
    
    const recipient = lottery.assignments[trimmedName];
    
    // Track that this person has viewed their assignment
    if (!lottery.viewedBy) {
        lottery.viewedBy = [];
    }
    if (!lottery.viewedBy.includes(trimmedName)) {
        lottery.viewedBy.push(trimmedName);
        await saveLottery(lottery);
    }
    
    res.json({ 
        success: true, 
        giver: trimmedName,
        recipient: recipient,
        family: lottery.familyMode ? lottery.families[trimmedName] : null
    });
});

// Participant: Check if lottery exists
app.get('/api/status', async (req, res) => {
    const lottery = await loadLottery();
    res.json({ 
        exists: !!lottery,
        participantCount: lottery ? lottery.participants.length : 0,
        viewedCount: lottery && lottery.viewedBy ? lottery.viewedBy.length : 0
    });
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
ensureDataDir().then(() => {
    app.listen(PORT, () => {
        console.log(`🎅 Sinterklaas Lootjes Server draait op http://localhost:${PORT}`);
        console.log(`📝 Admin wachtwoord: ${ADMIN_PASSWORD}`);
        console.log(`🔧 Admin interface: http://localhost:${PORT}/admin.html`);
        console.log(`🎁 Deelnemers interface: http://localhost:${PORT}`);
    });
});
