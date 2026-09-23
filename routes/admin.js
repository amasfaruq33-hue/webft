const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { requireAdmin } = require('../middleware/auth');
const { formatRupiah, generateId } = require('../utils/helpers');

// Admin credentials from env
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

// ==========================================
// ADMIN LOGIN
// ==========================================
router.get('/login', (req, res) => {
    if (req.session?.admin) return res.redirect('/admin');
    res.render('admin-login', { error: null });
});

router.post('/login', async (req, res) => {
    const username = (req.body.username || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        req.session.admin = { username: ADMIN_USER };
        return res.redirect('/admin');
    }

    res.render('admin-login', { error: 'Username atau password salah!' });
});

// ==========================================
// ADMIN LOGOUT
// ==========================================
router.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/admin/login');
});

// ==========================================
// ADMIN DASHBOARD
// ==========================================
router.get('/', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms ORDER BY createdAt DESC');
        const [users] = await req.db.execute('SELECT * FROM users ORDER BY createdAt DESC');
        const [transactions] = await req.db.execute('SELECT * FROM transactions ORDER BY createdAt DESC');

        const roomsWithPlayers = [];
        for (const room of rooms) {
            const [players] = await req.db.execute('SELECT userId, name, joinedAt FROM room_players WHERE roomId = ?', [room.id]);
            roomsWithPlayers.push({ ...room, players });
        }

        const pendingTransactions = transactions.filter(t => t.status === 'pending');

        res.render('admin-dashboard', {
            rooms: roomsWithPlayers,
            users,
            transactions: pendingTransactions,
            allTransactions: transactions,
            formatRupiah
        });
    } catch (err) {
        console.error('Error loading admin dashboard:', err);
        res.redirect('/admin/login');
    }
});

// ==========================================
// EDIT ROOM
// ==========================================
router.get('/room/:id/edit', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');
        res.render('admin-edit-room', { room, error: null, success: null });
    } catch (err) {
        res.redirect('/admin');
    }
});

router.post('/room/:id/edit', requireAdmin, async (req, res) => {
    try {
        const { name, fee, pp } = req.body;
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');

        await req.db.execute(
            'UPDATE rooms SET name = ?, fee = ?, pp = ? WHERE id = ?',
            [name || room.name, parseInt(fee) || room.fee, parseInt(pp) || room.pp, room.id]
        );

        const [updated] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [room.id]);
        res.render('admin-edit-room', { room: updated[0], error: null, success: 'Room berhasil diupdate!' });
    } catch (err) {
        console.error('Error editing room:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// MONITOR ROOM CHAT (ADMIN)
// ==========================================
router.get('/room/:id/monitor', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');
        if (!room.inProgress) return res.redirect('/admin');

        const [players] = await req.db.execute('SELECT userId, name, joinedAt FROM room_players WHERE roomId = ?', [room.id]);
        room.players = players;

        const [msgs] = await req.db.execute('SELECT * FROM messages WHERE roomId = ? ORDER BY time ASC', [room.id]);

        res.render('admin-monitor', {
            user: req.session.admin,
            room,
            messages: msgs,
            formatRupiah,
            adminKey: process.env.SESSION_SECRET || 'ft-platform-secret-key-2026'
        });
    } catch (err) {
        console.error('Error loading admin monitor:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// APPROVE TRANSACTION
// ==========================================
router.post('/transaction/:id/approve', requireAdmin, async (req, res) => {
    try {
        const [txRows] = await req.db.execute('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
        const tx = txRows[0];
        if (!tx) return res.redirect('/admin');

        await req.db.execute('UPDATE transactions SET status = ? WHERE id = ?', ['approved', tx.id]);

        if (tx.type === 'deposit') {
            await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [tx.amount, tx.userId]);
        } else if (tx.type === 'withdraw') {
            await req.db.execute('UPDATE users SET saldo = saldo - ? WHERE id = ?', [tx.amount, tx.userId]);
        }

        res.redirect('/admin');
    } catch (err) {
        console.error('Error approving transaction:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// REJECT TRANSACTION
// ==========================================
router.post('/transaction/:id/reject', requireAdmin, async (req, res) => {
    try {
        await req.db.execute('UPDATE transactions SET status = ? WHERE id = ?', ['rejected', req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Error rejecting transaction:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// TOP UP PLAYER
// ==========================================
router.post('/topup', requireAdmin, async (req, res) => {
    const { userId, amount } = req.body;
    const topupAmount = parseInt(amount);

    if (!userId || !topupAmount || topupAmount < 1) return res.redirect('/admin');

    try {
        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [userId]);
        const user = users[0];
        if (!user) return res.redirect('/admin');

        await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [topupAmount, userId]);

        await req.db.execute(
            'INSERT INTO transactions (id, userId, userName, type, amount, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [generateId(), userId, user.name, 'topup', topupAmount, 'approved']
        );

        res.redirect('/admin');
    } catch (err) {
        console.error('Error topping up:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// RESET ROOM PLAYERS
// ==========================================
router.post('/room/:id/reset', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');

        // Refund all players
        const [players] = await req.db.execute('SELECT userId FROM room_players WHERE roomId = ?', [room.id]);
        for (const player of players) {
            await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [room.fee, player.userId]);
        }

        await req.db.execute('DELETE FROM room_players WHERE roomId = ?', [room.id]);
        await req.db.execute(
            'UPDATE rooms SET status = ?, inProgress = 0, winnerId = NULL, winnerSetAt = NULL WHERE id = ?',
            ['open', room.id]
        );

        res.redirect('/admin');
    } catch (err) {
        console.error('Error resetting room:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// PAYOUT WINNER
// ==========================================
router.post('/room/:id/payout', requireAdmin, async (req, res) => {
    const { winnerId } = req.body;

    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');

        const [users] = await req.db.execute('SELECT * FROM users WHERE id = ?', [winnerId]);
        const winner = users[0];
        if (!winner) return res.redirect('/admin');

        // Credit pp to winner
        await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [room.pp, winnerId]);

        // Update room
        await req.db.execute(
            'UPDATE rooms SET winnerId = ?, winnerSetAt = NOW(), inProgress = 0, status = ? WHERE id = ?',
            [winnerId, 'selesai', room.id]
        );

        // Record transaction
        await req.db.execute(
            'INSERT INTO transactions (id, userId, userName, type, amount, roomId, roomName, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [generateId(), winnerId, winner.name, 'payout', room.pp, room.id, room.name, 'approved']
        );

        // Emit notification
        const io = req.app.get('io');
        if (io) {
            io.to(room.id).emit('winner-notification', {
                winnerName: winner.name,
                amount: room.pp
            });
        }

        res.redirect('/admin');
    } catch (err) {
        console.error('Error paying out:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// UNDO PAYOUT (5 menit)
// ==========================================
router.post('/room/:id/undo-payout', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');

        if (!room.winnerId || !room.winnerSetAt) return res.redirect('/admin');

        const elapsed = (Date.now() - new Date(room.winnerSetAt).getTime()) / 1000 / 60;
        if (elapsed > 5) return res.redirect('/admin');

        // Deduct from winner
        await req.db.execute('UPDATE users SET saldo = saldo - ? WHERE id = ?', [room.pp, room.winnerId]);

        // Remove payout transaction
        await req.db.execute(
            "DELETE FROM transactions WHERE type = 'payout' AND roomId = ? AND status = 'approved' ORDER BY createdAt DESC LIMIT 1",
            [room.id]
        );

        // Reset room
        await req.db.execute(
            'UPDATE rooms SET winnerId = NULL, winnerSetAt = NULL, inProgress = 1, status = ? WHERE id = ?',
            ['playing', room.id]
        );

        res.redirect('/admin');
    } catch (err) {
        console.error('Error undoing payout:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// CREATE ROOM
// ==========================================
router.post('/room/create', requireAdmin, async (req, res) => {
    const { name, fee, pp } = req.body;
    const feeAmount = parseInt(fee);
    const ppAmount = parseInt(pp);

    if (!name || !feeAmount || !ppAmount) return res.redirect('/admin');

    try {
        const newId = generateId();
        await req.db.execute(
            'INSERT INTO rooms (id, name, fee, pp, status, inProgress, createdAt) VALUES (?, ?, ?, ?, ?, 0, NOW())',
            [newId, name.trim(), feeAmount, ppAmount, 'open']
        );

        const io = req.app.get('io');
        if (io) io.emit('new-room');

        res.redirect('/admin');
    } catch (err) {
        console.error('Error creating room:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// DELETE ROOM
// ==========================================
router.post('/room/:id/delete', requireAdmin, async (req, res) => {
    try {
        const [rooms] = await req.db.execute('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
        const room = rooms[0];
        if (!room) return res.redirect('/admin');

        // Refund all players
        const [players] = await req.db.execute('SELECT userId FROM room_players WHERE roomId = ?', [room.id]);
        for (const player of players) {
            await req.db.execute('UPDATE users SET saldo = saldo + ? WHERE id = ?', [room.fee, player.userId]);
        }

        await req.db.execute('DELETE FROM rooms WHERE id = ?', [room.id]);

        res.redirect('/admin');
    } catch (err) {
        console.error('Error deleting room:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// APPROVE ROOM REQUEST
// ==========================================
router.post('/request-room/:id/approve', requireAdmin, async (req, res) => {
    try {
        const [txRows] = await req.db.execute('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
        const tx = txRows[0];
        if (!tx || tx.type !== 'request-room') return res.redirect('/admin');

        await req.db.execute('UPDATE transactions SET status = ? WHERE id = ?', ['approved', tx.id]);

        const newId = generateId();
        await req.db.execute(
            'INSERT INTO rooms (id, name, fee, pp, status, inProgress, createdAt) VALUES (?, ?, ?, ?, ?, 0, NOW())',
            [newId, tx.roomName, tx.fee, tx.pp, 'open']
        );

        const io = req.app.get('io');
        if (io) io.emit('new-room');

        res.redirect('/admin');
    } catch (err) {
        console.error('Error approving room request:', err);
        res.redirect('/admin');
    }
});

// ==========================================
// REJECT ROOM REQUEST
// ==========================================
router.post('/request-room/:id/reject', requireAdmin, async (req, res) => {
    try {
        await req.db.execute('UPDATE transactions SET status = ? WHERE id = ?', ['rejected', req.params.id]);
        res.redirect('/admin');
    } catch (err) {
        console.error('Error rejecting room request:', err);
        res.redirect('/admin');
    }
});

module.exports = router;
