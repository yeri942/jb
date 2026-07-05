let socket;
let player;
let myNickname = '';
let playlist = [];
let isSyncing = false;

const roomId = new URLSearchParams(location.search).get('id');

const sounds = {
    clapSound: new Audio('clap.mp3'),
    fireworkSound: new Audio('firework.mp3'),
};

// ── YouTube Player ──────────────────────────────────────────────────────────

function onYouTubeIframeAPIReady() {
    player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        videoId: '',
        playerVars: { autoplay: 0 },
        events: {
            onStateChange: onPlayerStateChange,
        },
    });
}

function onPlayerStateChange(event) {
    if (isSyncing || !socket) return;

    if (event.data === YT.PlayerState.PLAYING) {
        socket.emit('player:play', {
            videoId: player.getVideoData().video_id,
            currentTime: player.getCurrentTime(),
        });
    } else if (event.data === YT.PlayerState.PAUSED) {
        socket.emit('player:pause', {
            currentTime: player.getCurrentTime(),
        });
    } else if (event.data === YT.PlayerState.ENDED) {
        socket.emit('player:ended');
    }
}

function syncPlayer(videoId, currentTime, isPlaying) {
    isSyncing = true;
    const currentId = player.getVideoData && player.getVideoData().video_id;

    if (currentId !== videoId) {
        player.loadVideoById({ videoId, startSeconds: currentTime });
        if (!isPlaying) setTimeout(() => player.pauseVideo(), 800);
    } else {
        player.seekTo(currentTime, true);
        if (isPlaying) player.playVideo();
        else player.pauseVideo();
    }

    setTimeout(() => { isSyncing = false; }, 1200);
}

// ── Socket Events ────────────────────────────────────────────────────────────

function setupSocketListeners() {

socket.on('init', ({ roomName, currentVideoId, currentTime, isPlaying, playlist: p, users }) => {
    playlist = p;
    updateUI();
    updateUserCount(users);

    const nameDisplay = document.getElementById('room-name-display');
    if (nameDisplay) nameDisplay.textContent = roomName;

    if (currentVideoId) {
        isSyncing = true;
        player.loadVideoById({ videoId: currentVideoId, startSeconds: currentTime });
        if (!isPlaying) setTimeout(() => { player.pauseVideo(); isSyncing = false; }, 900);
        else setTimeout(() => { isSyncing = false; }, 900);
    }
});

socket.on('room:notfound', () => {
    alert('방을 찾을 수 없습니다. 로비로 돌아갑니다.');
    location.href = '/';
});

socket.on('chat:system', (msg) => addSystemMessage(msg));

socket.on('chat:message', ({ nickname, msg }) => {
    const isMe = nickname === myNickname;
    const d = document.createElement('div');
    if (isMe) {
        d.className = 'msg me';
        d.textContent = msg;
    } else {
        d.className = 'msg other';
        d.innerHTML = `<span class="chat-nick">${escapeHtml(nickname)}</span><span>${escapeHtml(msg)}</span>`;
    }
    appendChat(d);
});

socket.on('playlist:update', (p) => {
    playlist = p;
    updateUI();
});

socket.on('player:load', ({ videoId, startSeconds }) => {
    isSyncing = true;
    player.loadVideoById({ videoId, startSeconds });
    setTimeout(() => { isSyncing = false; }, 1200);
});

socket.on('player:sync', ({ videoId, currentTime, isPlaying }) => {
    syncPlayer(videoId, currentTime, isPlaying);
});

socket.on('action', ({ emoji, sound }) => {
    triggerEmoji(emoji);
    if (sounds[sound]) {
        sounds[sound].currentTime = 0;
        sounds[sound].play().catch(() => {});
    }
});

socket.on('user:update', (users) => updateUserCount(users));

} // end setupSocketListeners

// ── Login ────────────────────────────────────────────────────────────────────

const savedNickname = localStorage.getItem('jb_nickname');
if (savedNickname) {
    document.getElementById('nickname-input').value = savedNickname;
}

if (!roomId) {
    document.getElementById('login-room-name').textContent = '⚠️ 방 ID가 없습니다. 로비에서 입장해주세요.';
}

function setNickname() {
    if (!roomId) { location.href = '/'; return; }

    const n = document.getElementById('nickname-input').value.trim();
    if (!n) return;

    if (typeof io === 'undefined') {
        alert('⚠️ 서버가 실행되지 않고 있습니다.\n터미널에서 node server.js 를 먼저 실행해주세요!');
        return;
    }

    myNickname = n;
    localStorage.setItem('jb_nickname', n);
    document.getElementById('login-overlay').style.display = 'none';

    socket = io();
    setupSocketListeners();
    socket.emit('join', { roomId, nickname: n });
}

document.getElementById('nickname-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') setNickname();
});

// ── Playlist ─────────────────────────────────────────────────────────────────

function addSong() {
    const uInput = document.getElementById('youtube-url');
    const tInput = document.getElementById('song-name');
    const raw = uInput.value.trim();

    let id = raw;
    if (raw.includes('v=')) id = new URLSearchParams(raw.split('?')[1]).get('v') || raw.split('v=')[1].substring(0, 11);
    else if (raw.includes('youtu.be/')) id = raw.split('youtu.be/')[1].split('?')[0].substring(0, 11);

    const title = tInput.value.trim() || '제목 없음';
    if (id.length !== 11) return;

    socket.emit('playlist:add', { id, title, requester: myNickname });
    uInput.value = '';
    tInput.value = '';
}

function playNow(i) {
    socket.emit('playlist:playNow', i);
}

function updateUI() {
    document.getElementById('list-items').innerHTML = playlist
        .map((s, i) => `
            <div class="song-item">
                <div class="song-index">${i + 1}</div>
                <div class="song-info">
                    <div class="song-title">${escapeHtml(s.title)}</div>
                    <div class="song-meta">신청자: <span class="requester-tag">${escapeHtml(s.requester)}</span></div>
                </div>
                <button onclick="playNow(${i})" class="yellow-btn" style="padding:5px 10px;font-size:0.8rem">재생</button>
            </div>`)
        .join('');
}

// ── Chat ─────────────────────────────────────────────────────────────────────

function sendMessage() {
    const input = document.getElementById('chat-input');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat:send', msg);
    input.value = '';
}

function addSystemMessage(t) {
    const div = document.createElement('div');
    div.className = 'msg-system';
    div.textContent = t;
    appendChat(div);
}

function appendChat(el) {
    const msgBox = document.getElementById('chat-messages');
    msgBox.appendChild(el);
    msgBox.scrollTop = msgBox.scrollHeight;
}

// ── Actions ──────────────────────────────────────────────────────────────────

function sendAction(emoji, sound) {
    socket.emit('action', { emoji, sound });
}

function triggerEmoji(emoji) {
    const p = document.createElement('div');
    p.textContent = emoji;
    p.style.cssText = `position:fixed;bottom:0;left:${Math.random() * 80}vw;font-size:50px;transition:2s;pointer-events:none;z-index:2000;`;
    document.body.appendChild(p);
    setTimeout(() => { p.style.transform = 'translateY(-100vh)'; p.style.opacity = '0'; }, 10);
    setTimeout(() => p.remove(), 2500);
}

// ── Misc ─────────────────────────────────────────────────────────────────────

function updateUserCount(users) {
    const el = document.getElementById('user-count');
    if (el) el.textContent = `👤 ${users.length}명 접속 중`;
}

function toggleVideo() {
    document.getElementById('player-wrapper').classList.toggle('collapsed');
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Resizer ──────────────────────────────────────────────────────────────────

const resizer = document.getElementById('resizer');
const sideChat = document.getElementById('side-chat');
let isDragging = false;

resizer.addEventListener('mousedown', () => {
    isDragging = true;
    resizer.classList.add('dragging');
});
window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    if (window.innerWidth > 1024) sideChat.style.width = window.innerWidth - e.clientX + 'px';
    else sideChat.style.height = window.innerHeight - e.clientY + 'px';
});
window.addEventListener('mouseup', () => {
    isDragging = false;
    resizer.classList.remove('dragging');
});
