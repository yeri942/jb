const socket = io();
let myNickname = localStorage.getItem('jb_nickname') || '';

// ── Init ──────────────────────────────────────────────────────────────────────

if (!myNickname) {
    document.getElementById('nickname-modal').style.display = 'flex';
} else {
    document.getElementById('display-nickname').textContent = myNickname;
    socket.emit('lobby:join');
}

document.getElementById('nickname-modal-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') saveNickname();
});
document.getElementById('room-name-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') createRoom();
});

function saveNickname() {
    const n = document.getElementById('nickname-modal-input').value.trim();
    if (!n) return;
    myNickname = n;
    localStorage.setItem('jb_nickname', n);
    document.getElementById('display-nickname').textContent = n;
    document.getElementById('nickname-modal').style.display = 'none';
    socket.emit('lobby:join');
}

function changeNickname() {
    document.getElementById('nickname-modal-input').value = myNickname;
    document.getElementById('nickname-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('nickname-modal-input').focus(), 50);
}

// ── Room Events ───────────────────────────────────────────────────────────────

socket.on('rooms:update', (rooms) => {
    const list = document.getElementById('room-list');
    const count = document.getElementById('room-count');
    count.textContent = `(${rooms.length}개)`;

    if (rooms.length === 0) {
        list.innerHTML = '<div class="room-empty">아직 열린 방이 없어요. 첫 번째 방을 만들어보세요!</div>';
        return;
    }

    list.innerHTML = rooms.map(r => `
        <div class="room-card" onclick="enterRoom('${r.id}')">
            <div class="room-card-info">
                <div class="room-card-name">${escapeHtml(r.name)}</div>
                <div class="room-card-meta">방장: <span style="color:#ffcc00">${escapeHtml(r.host)}</span></div>
            </div>
            <div class="room-card-right">
                <div class="room-card-users">👤 ${r.userCount}명</div>
                <button class="yellow-btn" style="padding:8px 18px">입장</button>
            </div>
        </div>
    `).join('');
});

socket.on('room:created', (roomId) => {
    enterRoom(roomId);
});

// ── Actions ───────────────────────────────────────────────────────────────────

function createRoom() {
    const nameInput = document.getElementById('room-name-input');
    const name = nameInput.value.trim();
    if (!name) { nameInput.focus(); return; }
    if (!myNickname) { changeNickname(); return; }
    socket.emit('room:create', { name, host: myNickname });
    nameInput.value = '';
}

function enterRoom(roomId) {
    if (!myNickname) { changeNickname(); return; }
    location.href = `/room.html?id=${roomId}`;
}

function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
