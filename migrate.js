require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const db = require('./config/db');

const DATA_DIR = path.join(__dirname, 'data');

function readJSON(file) {
    try {
        const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        return {};
    }
}

async function migrate() {
    console.log('Starting migration from JSON to MySQL...');

    // Migrate users
    const usersData = readJSON('users.json');
    if (usersData.users && usersData.users.length > 0) {
        for (const user of usersData.users) {
            try {
                await db.execute(
                    'INSERT IGNORE INTO users (id, name, password, saldo, createdAt) VALUES (?, ?, ?, ?, ?)',
                    [user.id, user.name, user.password, user.saldo || 0, user.createdAt || new Date().toISOString()]
                );
                console.log(`  User migrated: ${user.name}`);
            } catch (err) {
                console.log(`  User skipped (exists): ${user.name}`);
            }
        }
    }
    console.log(`Total users: ${usersData.users?.length || 0}`);

    // Migrate rooms
    const roomsData = readJSON('rooms.json');
    if (roomsData.rooms && roomsData.rooms.length > 0) {
        for (const room of roomsData.rooms) {
            try {
                await db.execute(
                    'INSERT IGNORE INTO rooms (id, name, fee, pp, status, inProgress, winnerId, winnerSetAt, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        room.id, room.name, room.fee, room.pp,
                        room.status || 'open',
                        room.inProgress ? 1 : 0,
                        room.winnerId || null,
                        room.winnerSetAt || null,
                        room.createdAt || new Date().toISOString()
                    ]
                );

                // Migrate room players
                if (room.players && room.players.length > 0) {
                    for (const player of room.players) {
                        try {
                            await db.execute(
                                'INSERT INTO room_players (roomId, userId, name, joinedAt) VALUES (?, ?, ?, ?)',
                                [room.id, player.userId, player.name, player.joinedAt || new Date().toISOString()]
                            );
                        } catch (err) {
                            console.log(`  Player skipped: ${player.name} in ${room.name}`);
                        }
                    }
                }
                console.log(`  Room migrated: ${room.name}`);
            } catch (err) {
                console.log(`  Room skipped (exists): ${room.name}`);
            }
        }
    }
    console.log(`Total rooms: ${roomsData.rooms?.length || 0}`);

    // Migrate messages
    const messagesData = readJSON('messages.json');
    if (messagesData.messages) {
        let msgCount = 0;
        for (const [roomId, msgs] of Object.entries(messagesData.messages)) {
            for (const msg of msgs) {
                try {
                    await db.execute(
                        'INSERT IGNORE INTO messages (id, roomId, senderName, text, image, isSystem, time) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        [msg.id, roomId, msg.from, msg.text || '', msg.image || null, msg.isSystem ? 1 : 0, msg.time || new Date().toISOString()]
                    );

                    // Migrate seenBy
                    if (msg.seenBy && msg.seenBy.length > 0) {
                        for (const userName of msg.seenBy) {
                            try {
                                await db.execute(
                                    'INSERT IGNORE INTO message_seen (messageId, userName) VALUES (?, ?)',
                                    [msg.id, userName]
                                );
                            } catch (err) { /* skip */ }
                        }
                    }
                    msgCount++;
                } catch (err) {
                    console.log(`  Message skipped: ${msg.id}`);
                }
            }
        }
        console.log(`Total messages: ${msgCount}`);
    }

    // Migrate transactions
    const transactionsData = readJSON('transactions.json');
    if (transactionsData.transactions && transactionsData.transactions.length > 0) {
        for (const tx of transactionsData.transactions) {
            try {
                await db.execute(
                    'INSERT IGNORE INTO transactions (id, userId, userName, type, amount, bukti, rekening, roomName, roomId, fee, pp, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        tx.id, tx.userId || null, tx.userName, tx.type, tx.amount || 0,
                        tx.bukti || null, tx.rekening || null,
                        tx.roomName || null, tx.roomId || null,
                        tx.fee || null, tx.pp || null,
                        tx.status || 'pending',
                        tx.createdAt || new Date().toISOString()
                    ]
                );
            } catch (err) {
                console.log(`  Transaction skipped: ${tx.id}`);
            }
        }
    }
    console.log(`Total transactions: ${transactionsData.transactions?.length || 0}`);

    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});
