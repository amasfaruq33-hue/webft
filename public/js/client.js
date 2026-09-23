// Client-side JavaScript for Socket.io
// This file is loaded in the chat page

// Initialize socket connection
const socket = io();

// Room management
let currentRoom = null;

function joinRoom(roomId) {
    currentRoom = roomId;
    socket.emit('join-room', roomId);
}

function leaveRoom(roomId) {
    socket.emit('leave-room', roomId);
    currentRoom = null;
}

// Send chat message
function sendMessage(roomId, playerName, text, image) {
    socket.emit('chat-message', {
        roomId,
        playerName,
        text,
        image
    });
}

// Listen for new messages
socket.on('new-message', (msg) => {
    // This is handled in the EJS template's inline script
    // But you can use this for additional functionality
    console.log('New message:', msg);
});

// Listen for slot updates
socket.on('slot-update', (data) => {
    console.log('Slot update:', data);
    // Could update UI here without page reload
});

// Listen for room updates (for dashboard)
socket.on('room-update', (data) => {
    console.log('Room update:', data);
    // Could update room cards without page reload
});

// Connection status
socket.on('connect', () => {
    console.log('Connected to server');
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
});
