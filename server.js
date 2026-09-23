require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieSession = require('cookie-session');
const db = require('./config/db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ==========================================
// MIDDLEWARE
// ==========================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieSession({
    name: 'session',
    keys: [process.env.SESSION_SECRET || 'ft-platform-secret-key-2026'],
    maxAge: 24 * 60 * 60 * 1000
}));

// Make db and io available to routes
app.use((req, res, next) => {
    req.db = db;
    req.io = io;
    res.locals.user = req.session?.user || null;
    res.locals.admin = req.session?.admin || null;
    next();
});

// Store io on app for admin routes
app.set('io', io);

// ==========================================
// ROUTES
// ==========================================
const playerRoutes = require('./routes/player');
const adminRoutes = require('./routes/admin');

app.use('/', playerRoutes);
app.use('/admin', adminRoutes);

// Root redirect
app.get('/', (req, res) => {
    if (req.session?.user) {
        return res.redirect('/dashboard');
    }
    res.redirect('/login');
});

// ==========================================
// SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
    });

    socket.on('leave-room', (roomId) => {
        socket.leave(roomId);
    });

    socket.on('chat-message', async (data) => {
        const { roomId, playerName, text, image } = data;
        const msgId = Date.now().toString();

        try {
            await db.execute(
                'INSERT INTO messages (id, roomId, senderName, text, image, isSystem, time) VALUES (?, ?, ?, ?, ?, 0, NOW())',
                [msgId, roomId, playerName, text || '', image || null]
            );

            await db.execute(
                'INSERT INTO message_seen (messageId, userName) VALUES (?, ?)',
                [msgId, playerName]
            );

            const msg = {
                id: msgId,
                from: playerName,
                text: text || '',
                image: image || null,
                isSystem: false,
                time: new Date().toISOString()
            };

            io.to(roomId).emit('new-message', msg);
        } catch (err) {
            console.error('Error saving chat message:', err);
        }
    });

    socket.on('message-seen', async (data) => {
        const { roomId, userName, messageIds } = data;
        if (!roomId || !userName || !messageIds || !messageIds.length) return;

        try {
            for (const msgId of messageIds) {
                await db.execute(
                    'INSERT IGNORE INTO message_seen (messageId, userName) VALUES (?, ?)',
                    [msgId, userName]
                );
            }

            const [room] = await db.execute('SELECT id FROM rooms WHERE id = ?', [roomId]);
            const [players] = await db.execute('SELECT COUNT(*) as cnt FROM room_players WHERE roomId = ?', [roomId]);
            const totalPlayers = players[0]?.cnt || 4;

            io.to(roomId).emit('seen-update', {
                roomId,
                messageIds,
                userName,
                totalPlayers
            });
        } catch (err) {
            console.error('Error marking messages seen:', err);
        }
    });

    socket.on('player-joined', (data) => {
        const { roomId, players } = data;
        io.to(roomId).emit('slot-update', { roomId, players });
        io.emit('room-update', { roomId, players });
    });

    socket.on('player-left', (data) => {
        const { roomId, players } = data;
        io.to(roomId).emit('slot-update', { roomId, players });
        io.emit('room-update', { roomId, players });
    });

    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

// ==========================================
// START SERVER
// ==========================================
server.listen(PORT, () => {
    console.log(`RICO FT running on http://localhost:${PORT}`);
});
