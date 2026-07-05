const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'lobby.html')));
app.use(express.static(path.join(__dirname)));

const rooms = new Map();

function generateId() {
    return Math.random().toString(36).substring(2, 8);
}

function getRoomList() {
    return [...rooms.values()].map(r => ({
        id: r.id,
        name: r.name,
        host: r.host,
        userCount: Object.keys(r.users).length,
    }));
}

function broadcastRoomList() {
    io.to('lobby').emit('rooms:update', getRoomList());
}

function getEstimatedTime(room) {
    if (!room.isPlaying) return room.currentTime;
    return room.currentTime + (Date.now() - room.lastSyncAt) / 1000;
}

io.on('connection', (socket) => {

    // ── Lobby ─────────────────────────────────────────────────────────────────

    socket.on('lobby:join', () => {
        socket.join('lobby');
        socket.emit('rooms:update', getRoomList());
    });

    socket.on('room:create', ({ name, host }) => {
        const id = generateId();
        rooms.set(id, {
            id, name, host,
            createdAt: Date.now(),
            currentVideoId: '',
            currentTime: 0,
            isPlaying: false,
            lastSyncAt: Date.now(),
            playlist: [],
            users: {},
        });
        broadcastRoomList();
        socket.emit('room:created', id);
    });

    // ── Room ──────────────────────────────────────────────────────────────────

    socket.on('join', ({ roomId, nickname }) => {
        const room = rooms.get(roomId);
        if (!room) { socket.emit('room:notfound'); return; }

        socket.leave('lobby');
        socket.join(roomId);
        room.users[socket.id] = nickname;
        socket.data.roomId = roomId;
        socket.data.nickname = nickname;

        socket.emit('init', {
            roomName: room.name,
            currentVideoId: room.currentVideoId,
            currentTime: getEstimatedTime(room),
            isPlaying: room.isPlaying,
            playlist: room.playlist,
            users: Object.values(room.users),
        });

        io.to(roomId).emit('user:update', Object.values(room.users));
        io.to(roomId).emit('chat:system', `— ${nickname}님이 입장하였습니다 —`);
        broadcastRoomList();
    });

    socket.on('chat:send', (msg) => {
        const { roomId, nickname } = socket.data;
        if (!roomId) return;
        io.to(roomId).emit('chat:message', { nickname, msg });
    });

    socket.on('playlist:add', (song) => {
        const room = rooms.get(socket.data.roomId);
        if (!room) return;
        room.playlist.push(song);
        io.to(room.id).emit('playlist:update', room.playlist);
        io.to(room.id).emit('chat:system', `[곡 추가] ${song.requester}님이 "${song.title}"를 추가했습니다.`);
    });

    socket.on('playlist:playNow', (index) => {
        const room = rooms.get(socket.data.roomId);
        if (!room) return;
        const song = room.playlist.splice(index, 1)[0];
        if (!song) return;
        room.currentVideoId = song.id;
        room.currentTime = 0;
        room.isPlaying = true;
        room.lastSyncAt = Date.now();
        io.to(room.id).emit('playlist:update', room.playlist);
        io.to(room.id).emit('player:load', { videoId: song.id, startSeconds: 0 });
    });

    socket.on('player:play', ({ videoId, currentTime }) => {
        const room = rooms.get(socket.data.roomId);
        if (!room) return;
        room.currentVideoId = videoId;
        room.currentTime = currentTime;
        room.isPlaying = true;
        room.lastSyncAt = Date.now();
        socket.to(room.id).emit('player:sync', { videoId, currentTime, isPlaying: true });
    });

    socket.on('player:pause', ({ currentTime }) => {
        const room = rooms.get(socket.data.roomId);
        if (!room) return;
        room.currentTime = currentTime;
        room.isPlaying = false;
        room.lastSyncAt = Date.now();
        socket.to(room.id).emit('player:sync', { videoId: room.currentVideoId, currentTime, isPlaying: false });
    });

    socket.on('player:ended', () => {
        const room = rooms.get(socket.data.roomId);
        if (!room) return;
        if (room.playlist.length > 0) {
            const next = room.playlist.shift();
            room.currentVideoId = next.id;
            room.currentTime = 0;
            room.isPlaying = true;
            room.lastSyncAt = Date.now();
            io.to(room.id).emit('playlist:update', room.playlist);
            io.to(room.id).emit('player:load', { videoId: next.id, startSeconds: 0 });
        } else {
            room.isPlaying = false;
        }
    });

    socket.on('action', ({ emoji, sound }) => {
        const { roomId } = socket.data;
        if (!roomId) return;
        io.to(roomId).emit('action', { emoji, sound });
    });

    socket.on('disconnect', () => {
        const { roomId, nickname } = socket.data;
        if (!roomId) return;
        const room = rooms.get(roomId);
        if (!room) return;
        delete room.users[socket.id];
        io.to(roomId).emit('user:update', Object.values(room.users));
        io.to(roomId).emit('chat:system', `— ${nickname}님이 퇴장하였습니다 —`);
        if (Object.keys(room.users).length === 0) rooms.delete(roomId);
        broadcastRoomList();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Social Jukebox → http://localhost:${PORT}`));
