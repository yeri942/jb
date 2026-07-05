let socket;
let player;
let myNickname = '';
let playlist = [];
let currentSong = null;
let isSyncing = false;
let audioCtx = null;

const roomId = new URLSearchParams(location.search).get('id');

function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// 첫 터치/클릭 시 오디오 잠금 해제 (iOS 필수)
document.addEventListener('touchstart', getAudioCtx, { once: true });
document.addEventListener('click', getAudioCtx, { once: true });

function playSound(type) {
    try {
        const ctx = getAudioCtx();
        if (type === 'clapSound') {
            const size = Math.floor(ctx.sampleRate * 0.15);
            const buf = ctx.createBuffer(1, size, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const hp = ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 800;
            src.connect(hp);
            hp.connect(ctx.destination);
            src.start();
        } else if (type === 'fireworkSound') {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(300, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.3);
            gain.gain.setValueAtTime(0.4, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        }
    } catch(e) {}
}

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

socket.on('init', ({ roomName, currentVideoId, currentTime, isPlaying, currentSong: cs, playlist: p, users }) => {
    playlist = p;
    currentSong = cs || null;
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

socket.on('player:load', ({ videoId, startSeconds, song }) => {
    isSyncing = true;
    currentSong = song || null;
    updateUI();
    player.loadVideoById({ videoId, startSeconds });
    setTimeout(() => { isSyncing = false; }, 1200);
});

socket.on('player:sync', ({ videoId, currentTime, isPlaying }) => {
    syncPlayer(videoId, currentTime, isPlaying);
});

socket.on('action', ({ emoji, sound }) => {
    triggerEmoji(emoji);
    playSound(sound);
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

function extractVideoId(raw) {
    if (!raw) return null;
    if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
    try {
        const url = new URL(raw);
        if (url.hostname === 'youtu.be') return url.pathname.slice(1, 12) || null;
        const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
        if (shorts) return shorts[1];
        const v = url.searchParams.get('v');
        if (v && v.length === 11) return v;
    } catch(e) {}
    const m = raw.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function addSong() {
    if (!socket) return;
    const uInput = document.getElementById('youtube-url');
    const tInput = document.getElementById('song-name');
    const id = extractVideoId(uInput.value.trim());

    if (!id) {
        uInput.style.outline = '2px solid #ff4444';
        setTimeout(() => { uInput.style.outline = ''; }, 1500);
        return;
    }

    const title = tInput.value.trim() || '제목 없음';
    socket.emit('playlist:add', { id, title, requester: myNickname });
    uInput.value = '';
    tInput.value = '';
}

function playNow(i) {
    socket.emit('playlist:playNow', i);
}

function updateUI() {
    const placeholder = document.getElementById('player-placeholder');
    if (placeholder) placeholder.classList.toggle('hidden', currentSong !== null);

    const nowPlaying = currentSong ? `
        <div class="song-item now-playing">
            <div class="song-index">▶</div>
            <div class="song-info">
                <div class="song-title">${escapeHtml(currentSong.title)}</div>
                <div class="song-meta">신청자: <span class="requester-tag">${escapeHtml(currentSong.requester)}</span></div>
            </div>
            <span class="now-playing-badge">🎵 재생 중</span>
        </div>` : '';

    const queue = playlist.map((s, i) => `
        <div class="song-item">
            <div class="song-index">${i + 1}</div>
            <div class="song-info">
                <div class="song-title">${escapeHtml(s.title)}</div>
                <div class="song-meta">신청자: <span class="requester-tag">${escapeHtml(s.requester)}</span></div>
            </div>
            <button onclick="playNow(${i})" class="yellow-btn" style="padding:5px 10px;font-size:0.8rem">재생</button>
        </div>`).join('');

    document.getElementById('list-items').innerHTML = nowPlaying + queue;
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
    const layer = document.getElementById('emoji-layer');
    const p = document.createElement('div');
    p.textContent = emoji;
    p.className = 'flying-emoji';
    p.style.left = Math.random() * 80 + 'vw';
    layer.appendChild(p);
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

function onDragStart() {
    isDragging = true;
    resizer.classList.add('dragging');
}
function onDragMove(clientX, clientY) {
    if (!isDragging) return;
    if (window.innerWidth > 1024) sideChat.style.width = window.innerWidth - clientX + 'px';
    else sideChat.style.height = window.innerHeight - clientY + 'px';
}
function onDragEnd() {
    isDragging = false;
    resizer.classList.remove('dragging');
}

// 마우스
resizer.addEventListener('mousedown', onDragStart);
window.addEventListener('mousemove', (e) => onDragMove(e.clientX, e.clientY));
window.addEventListener('mouseup', onDragEnd);

// 터치
resizer.addEventListener('touchstart', (e) => { e.preventDefault(); onDragStart(); }, { passive: false });
window.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    e.preventDefault();
    onDragMove(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
window.addEventListener('touchend', onDragEnd);
