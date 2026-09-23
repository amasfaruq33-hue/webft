const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const { requireLogin } = require('../middleware/auth');
const { formatRupiah, generateId } = require('../utils/helpers');

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

async function createPairingMessage(room, io, db) {
    const [rows] = await db.execute('SELECT userId, name FROM room_players WHERE roomId = ?', [room.id]);
    const players = rows;

    if (players.length < 4) return null;

    const shuffled = shuffleArray(players);
    const p1 = shuffled[0];
    const p2 = shuffled[1];
    const p3 = shuffled[2];
    const p4 = shuffled[3];

    const pairingText =
        `🏆 *MATCH PAIRING* 🏆\n\n` +
        `P1\n` +
        `${p1.name} vs ${p2.name}\n\n` +
        `P2\n` +
        `${p3.name} vs ${p4.name}\n\n` +
        `WIN TAG SEKALI\n` +
        `SEND NOPE AJA NANTI ADMIN TF\n` +
        `DILARANG KERAS PM ❗❗\n\n` +
        `15MENIT SAMA SAMA GAMAU OPR DIS DUA DUANYA ❗`;

    const msgId = Date.now().toString();
    await db.execute(
        'INSERT INTO messages (id, roomId, senderName, text, image, isSystem, time) VALUES (?, ?, ?, ?, ?, 1, NOW())',
        [msgId, room.id, '🏆 POT', pairingText, null]
    );

    const msg = {
        id: msgId,
        from: '🏆 POT',
        text: pairingText,
        image: null,
        isSystem: true,
        time: new Date().toISOString()
    };

    if (io) {
        io.to(room.id).emit('new-message', msg);
        io.to(room.id).emit('pairing-notification', {
            p1: p1.name, p2: p2.name,
            p3: p3.name, p4: p4.name
        });
    }

    return msg;
}

// Multer config for image uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ==========================================
// SHARE LINK: JOIN ROOM
// ==========================================
router.get('/join/:id', async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];

        if (!room) return res.redirect('/dashboard');

        if (!req.session?.user) {
            req.session.redirectJoin = req.params.id;
            return res.redirect('/register');
        }

        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        if (!user) {
            req.session.redirectJoin = req.params.id;
            return res.redirect('/register');
        }

        if (room.inProgress) return res.redirect('/dashboard');

        const [playerCount] = await req.db.execute('SELECT COUNT(*) as cnt FROM room_players WHERE roomId = ?', [room.id]);
        if (playerCount[0].cnt >= 4) return res.redirect('/dashboard');

        const [alreadyIn] = await req.db.execute('SELECT id FROM room_players WHERE roomId = ? AND userId = ?', [room.id, user.id]);
        if (alreadyIn.length > 0) return res.redirect(`/room/${room.id}`);

        if (user.saldo < room.fee) {
            req.session.redirectJoin = req.params.id;
            return res.redirect('/deposit');
        }

        // Join room
        await req.db.execute(
            'INSERT INTO room_players (roomId, userId, name, joinedAt) VALUES (?, ?, ?, NOW())',
            [room.id, user.id, user.name]
        );
        await req.db.execute('UPDATE users SET saldo = saldo - ? WHERE id = ?', [room.fee, user.id]);

        const [newPlayerCount] = await req.db.execute('SELECT COUNT(*) as cnt FROM room_players WHERE roomId = ?', [room.id]);
        if (newPlayerCount[0].cnt >= 4) {
            await req.db.execute('UPDATE rooms SET inProgress = 1, status = ? WHERE id = ?', ['playing', room.id]);
            await createPairingMessage({ id: room.id }, req.io, req.db);
        }

        req.session.redirectJoin = null;
        res.redirect(`/room/${room.id}`);
    } catch (err) {
        console.error('Error joining room:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// AUTH: REGISTER
// ==========================================
router.get('/register', (req, res) => {
    if (req.session?.user) {
        const redirectJoin = req.session.redirectJoin;
        if (redirectJoin) {
            req.session.redirectJoin = null;
            return res.redirect('/join/' + redirectJoin);
        }
        return res.redirect('/dashboard');
    }
    res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
    const { name, password, confirmPassword } = req.body;

    if (!name || !password || !confirmPassword) {
        return res.render('register', { error: 'Semua field wajib diisi!' });
    }

    if (password !== confirmPassword) {
        return res.render('register', { error: 'Password tidak cocok!' });
    }

    if (password.length < 4) {
        return res.render('register', { error: 'Password minimal 4 karakter!' });
    }

    try {
        const [existing] = await req.db.execute('SELECT id FROM users WHERE LOWER(name) = LOWER(?)', [name]);
        if (existing.length > 0) {
            return res.render('register', { error: 'Nama sudah terdaftar!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newId = generateId();

        await req.db.execute(
            'INSERT INTO users (id, name, password, saldo, createdAt) VALUES (?, ?, ?, 0, NOW())',
            [newId, name.trim(), hashedPassword]
        );

        req.session.user = { id: newId, name: name.trim() };

        const redirectJoin = req.session.redirectJoin;
        if (redirectJoin) {
            req.session.redirectJoin = null;
            return res.redirect('/join/' + redirectJoin);
        }
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error registering:', err);
        res.render('register', { error: 'Terjadi kesalahan, coba lagi!' });
    }
});

// ==========================================
// AUTH: LOGIN
// ==========================================
router.get('/login', (req, res) => {
    if (req.session?.user) {
        const redirectJoin = req.session.redirectJoin;
        if (redirectJoin) {
            req.session.redirectJoin = null;
            return res.redirect('/join/' + redirectJoin);
        }
        return res.redirect('/dashboard');
    }
    res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
    const { name, password } = req.body;

    if (!name || !password) {
        return res.render('login', { error: 'Semua field wajib diisi!' });
    }

    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE LOWER(name) = LOWER(?)', [name]);
        const user = users[0];

        if (!user) {
            return res.render('login', { error: 'Nama tidak ditemukan!' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.render('login', { error: 'Password salah!' });
        }

        req.session.user = { id: user.id, name: user.name };

        const redirectJoin = req.session.redirectJoin;
        if (redirectJoin) {
            req.session.redirectJoin = null;
            return res.redirect('/join/' + redirectJoin);
        }
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error logging in:', err);
        res.render('login', { error: 'Terjadi kesalahan, coba lagi!' });
    }
});

// ==========================================
// AUTH: LOGOUT
// ==========================================
router.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/login');
});

// ==========================================
// DASHBOARD PLAYER
// ==========================================
router.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        const [rooms] = await req.db.execute('SELECT * FROM rooms ORDER BY createdAt DESC');

        const roomsWithPlayers = [];
        for (const room of rooms) {
            const [players] = await req.db.execute('SELECT userId, name, joinedAt FROM room_players WHERE roomId = ?', [room.id]);
            roomsWithPlayers.push({ ...room, players });
        }

        res.render('player-dashboard', { user, rooms: roomsWithPlayers, formatRupiah });
    } catch (err) {
        console.error('Error loading dashboard:', err);
        res.redirect('/login');
    }
});

// ==========================================
// DEPOSIT
// ==========================================
router.get('/deposit', requireLogin, (req, res) => {
    res.render('deposit', { error: null, success: null });
});

router.post('/deposit', requireLogin, upload.single('bukti'), async (req, res) => {
    const { nominal } = req.body;
    const amount = parseInt(nominal);

    if (!amount || amount < 1000) {
        return res.render('deposit', { error: 'Minimal deposit Rp 1.000!', success: null });
    }

    try {
        await req.db.execute(
            'INSERT INTO transactions (id, userId, userName, type, amount, bukti, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [generateId(), req.session.user.id, req.session.user.name, 'deposit', amount, req.file ? req.file.filename : null, 'pending']
        );
        res.render('deposit', { error: null, success: 'Deposit berhasil dikirim, tunggu admin approve!' });
    } catch (err) {
        console.error('Error depositing:', err);
        res.render('deposit', { error: 'Terjadi kesalahan, coba lagi!', success: null });
    }
});

// ==========================================
// WITHDRAW
// ==========================================
router.get('/withdraw', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        res.render('withdraw', { user, error: null, success: null });
    } catch (err) {
        res.redirect('/dashboard');
    }
});

router.post('/withdraw', requireLogin, async (req, res) => {
    const { amount, rekening } = req.body;
    const withdrawAmount = parseInt(amount);

    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];

        if (!withdrawAmount || withdrawAmount < 1000) {
            return res.render('withdraw', { user, error: 'Minimal withdraw Rp 1.000!', success: null });
        }

        if (withdrawAmount > user.saldo) {
            return res.render('withdraw', { user, error: 'Saldo tidak cukup!', success: null });
        }

        await req.db.execute(
            'INSERT INTO transactions (id, userId, userName, type, amount, rekening, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [generateId(), req.session.user.id, req.session.user.name, 'withdraw', withdrawAmount, rekening || '-', 'pending']
        );

        res.render('withdraw', { user, error: null, success: 'Withdraw berhasil dikirim, tunggu admin approve!' });
    } catch (err) {
        console.error('Error withdrawing:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// ROOM DETAIL PAGE
// ==========================================
router.get('/room/:id', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];

        if (!room) return res.redirect('/dashboard');

        const [players] = await req.db.execute('SELECT userId, name, joinedAt FROM room_players WHERE roomId = ?', [room.id]);
        room.players = players;

        const [msgs] = await req.db.execute('SELECT * FROM messages WHERE roomId = ? ORDER BY time ASC', [room.id]);
        const messages = [];
        for (const m of msgs) {
            const [seenRows] = await req.db.execute('SELECT userName FROM message_seen WHERE messageId = ?', [m.id]);
            messages.push({
                id: m.id,
                from: m.senderName,
                text: m.text,
                image: m.image,
                isSystem: m.isSystem === 1,
                seenBy: seenRows.map(r => r.userName),
                time: m.time
            });
        }

        res.render('room', { user, room, messages, formatRupiah });
    } catch (err) {
        console.error('Error loading room:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// JOIN ROOM
// ==========================================
router.post('/room/:id/join', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];

        if (!room) return res.redirect('/dashboard');
        if (room.inProgress) return res.redirect('/dashboard');

        const [playerCount] = await req.db.execute('SELECT COUNT(*) as cnt FROM room_players WHERE roomId = ?', [room.id]);
        if (playerCount[0].cnt >= 4) return res.redirect(`/room/${room.id}`);

        const [alreadyIn] = await req.db.execute('SELECT id FROM room_players WHERE roomId = ? AND userId = ?', [room.id, user.id]);
        if (alreadyIn.length > 0) return res.redirect(`/room/${room.id}`);

        if (user.saldo < room.fee) return res.redirect('/dashboard');

        await req.db.execute(
            'INSERT INTO room_players (roomId, userId, name, joinedAt) VALUES (?, ?, ?, NOW())',
            [room.id, user.id, user.name]
        );
        await req.db.execute('UPDATE users SET saldo = saldo - ? WHERE id = ?', [room.fee, user.id]);

        const [newPlayerCount] = await req.db.execute('SELECT COUNT(*) as cnt FROM room_players WHERE roomId = ?', [room.id]);
        if (newPlayerCount[0].cnt >= 4) {
            await req.db.execute('UPDATE rooms SET inProgress = 1, status = ? WHERE id = ?', ['playing', room.id]);
            await createPairingMessage({ id: room.id }, req.io, req.db);
        }

        res.redirect(`/room/${room.id}`);
    } catch (err) {
        console.error('Error joining room:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// LEAVE ROOM
// ==========================================
router.post('/room/:id/leave', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];

        if (!room) return res.redirect('/dashboard');
        if (room.inProgress) return res.redirect(`/room/${room.id}`);

        await req.db.execute('DELETE FROM room_players WHERE roomId = ? AND userId = ?', [room.id, user.id]);
        await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [room.fee, user.id]);

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error leaving room:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// ROOM CHAT PAGE
// ==========================================
router.get('/room/:id/chat', requireLogin, async (req, res) => {
    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        const user = users[0];
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];

        if (!room) return res.redirect('/dashboard');

        const [inRoom] = await req.db.execute('SELECT id FROM room_players WHERE roomId = ? AND userId = ?', [room.id, user.id]);
        if (inRoom.length === 0) return res.redirect(`/room/${room.id}`);

        const [players] = await req.db.execute('SELECT userId, name, joinedAt FROM room_players WHERE roomId = ?', [room.id]);
        room.players = players;

        const [msgs] = await req.db.execute('SELECT * FROM messages WHERE roomId = ? ORDER BY time ASC', [room.id]);
        const messages = [];
        for (const m of msgs) {
            const [seenRows] = await req.db.execute('SELECT userName FROM message_seen WHERE messageId = ?', [m.id]);
            messages.push({
                id: m.id,
                from: m.senderName,
                text: m.text,
                image: m.image,
                isSystem: m.isSystem === 1,
                seenBy: seenRows.map(r => r.userName),
                time: m.time
            });
        }

        res.render('chat', { user, room, messages, formatRupiah });
    } catch (err) {
        console.error('Error loading chat:', err);
        res.redirect('/dashboard');
    }
});

// ==========================================
// CHAT IMAGE UPLOAD
// ==========================================
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '-'))
});
const chatUpload = multer({ storage: multerStorage, limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/upload-chat-image', requireLogin, chatUpload.single('image'), (req, res) => {
    if (!req.file) {
        return res.json({ error: 'No file uploaded' });
    }
    res.json({ filename: req.file.filename });
});

// ==========================================
// REQUEST ROOM
// ==========================================
router.post('/request-room', requireLogin, async (req, res) => {
    const { roomName, fee, pp } = req.body;
    const feeAmount = parseInt(fee);
    const ppAmount = parseInt(pp);

    if (!roomName || !feeAmount || !ppAmount) {
        return res.redirect('/dashboard');
    }

    try {
        await req.db.execute(
            'INSERT INTO transactions (id, userId, userName, type, roomName, fee, pp, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [generateId(), req.session.user.id, req.session.user.name, 'request-room', roomName.trim(), feeAmount, ppAmount, 'pending']
        );
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Error requesting room:', err);
        res.redirect('/dashboard');
    }
});

module.exports = router;
