const socket = io();
let player;
let playerReady = false;
let ignorePlayerEventsUntil = 0;
let latestState = null;
let joinedRoom = false;

const els = {
  nameInput: document.getElementById('nameInput'),
  roomInput: document.getElementById('roomInput'),
  joinBtn: document.getElementById('joinBtn'),
  urlInput: document.getElementById('urlInput'),
  titleInput: document.getElementById('titleInput'),
  addBtn: document.getElementById('addBtn'),
  queueList: document.getElementById('queueList'),
  chatList: document.getElementById('chatList'),
  memberList: document.getElementById('memberList'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  playBtn: document.getElementById('playBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  nextBtn: document.getElementById('nextBtn'),
  trackMeta: document.getElementById('trackMeta'),
  roomSummary: document.getElementById('roomSummary'),
  statusBadge: document.getElementById('statusBadge'),
  reactions: document.getElementById('reactions')
};

function toast(message) {
  const div = document.createElement('div');
  div.className = 'toast';
  div.textContent = message;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2800);
}

function readQuery() {
  const params = new URLSearchParams(location.search);
  return {
    room: params.get('room') || 'main-room',
    name: params.get('name') || `Khách ${Math.floor(Math.random() * 90 + 10)}`
  };
}

function writeQuery(room, name) {
  const params = new URLSearchParams(location.search);
  params.set('room', room);
  params.set('name', name);
  history.replaceState({}, '', `${location.pathname}?${params.toString()}`);
}

function setIgnoreWindow() {
  ignorePlayerEventsUntil = Date.now() + 1200;
}

function shouldIgnorePlayerEvent() {
  return Date.now() < ignorePlayerEventsUntil;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderQueueItem(item, index, state) {
  const wrap = document.createElement('div');
  wrap.className = `queue-item ${index === state.currentIndex ? 'active' : ''}`;
  const isFirst = index === 0;
  const isLast = index === state.queue.length - 1;
  wrap.innerHTML = `
    <div class="queue-item-top">
      <button class="queue-select" data-action="select"><strong>${index + 1}. ${escapeHtml(item.title)}</strong><div>${escapeHtml(item.videoId)} · thêm bởi ${escapeHtml(item.addedBy)}</div></button>
      <div class="queue-actions">
        <button class="ghost small" data-action="up" ${isFirst ? 'disabled' : ''}>↑</button>
        <button class="ghost small" data-action="down" ${isLast ? 'disabled' : ''}>↓</button>
        <button class="danger small" data-action="remove">Xóa</button>
      </div>
    </div>`;

  wrap.querySelector('[data-action="select"]').onclick = () => socket.emit('track:select', { index });
  wrap.querySelector('[data-action="up"]').onclick = () => socket.emit('queue:move', { fromIndex: index, toIndex: index - 1 });
  wrap.querySelector('[data-action="down"]').onclick = () => socket.emit('queue:move', { fromIndex: index, toIndex: index + 1 });
  wrap.querySelector('[data-action="remove"]').onclick = () => {
    const ok = confirm(`Xóa bài "${item.title}"?`);
    if (ok) socket.emit('queue:remove', { index });
  };
  return wrap;
}

function renderState(state) {
  latestState = state;
  els.statusBadge.textContent = state.playback.isPlaying ? 'Đang phát' : 'Đã tạm dừng';
  const current = state.queue[state.currentIndex];
  els.trackMeta.textContent = current
    ? `${current.title} · thêm bởi ${current.addedBy}`
    : 'Chưa có bài nào';
  els.roomSummary.textContent = `${state.users.length} nguoi · ${state.queue.length} bai · video ${state.playback.videoId || 'none'}`;

  els.queueList.innerHTML = '';
  state.queue.forEach((item, index) => {
    els.queueList.appendChild(renderQueueItem(item, index, state));
  });

  els.memberList.innerHTML = '';
  state.users.forEach((user) => {
    const item = document.createElement('div');
    item.className = 'member-item';
    item.textContent = user.name;
    els.memberList.appendChild(item);
  });

  els.chatList.innerHTML = '';
  state.chat.forEach(appendChat);
}

function appendChat(msg) {
  const item = document.createElement('div');
  item.className = 'chat-item';
  item.innerHTML = `<strong>${escapeHtml(msg.user)}</strong><div>${escapeHtml(msg.text)}</div><small>${escapeHtml(msg.time)}</small>`;
  els.chatList.appendChild(item);
  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function spawnReaction(emoji) {
  const node = document.createElement('div');
  node.className = 'reaction-float';
  node.textContent = emoji;
  node.style.left = `${12 + Math.random() * 70}%`;
  els.reactions.appendChild(node);
  setTimeout(() => node.remove(), 1800);
}

function syncPlayer(playback) {
  if (!playerReady || !playback.videoId) return;

  const currentVideo = typeof player.getVideoData === 'function' ? player.getVideoData().video_id : '';
  const targetPos = Math.max(0, Number(playback.position || 0));

  setIgnoreWindow();

  if (currentVideo !== playback.videoId) {
    player.loadVideoById({ videoId: playback.videoId, startSeconds: targetPos });
    if (!playback.isPlaying) {
      setTimeout(() => player.pauseVideo(), 500);
    }
    return;
  }

  const currentTime = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
  if (Math.abs(currentTime - targetPos) > 2.5) {
    player.seekTo(targetPos, true);
  }

  const state = player.getPlayerState();
  if (playback.isPlaying) {
    if (state !== YT.PlayerState.PLAYING) player.playVideo();
  } else {
    if (state !== YT.PlayerState.PAUSED) player.pauseVideo();
  }
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    videoId: 'jfKfPfyJRdk',
    playerVars: { playsinline: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        if (latestState) syncPlayer(latestState.playback);
      },
      onStateChange: (event) => {
        if (!joinedRoom || shouldIgnorePlayerEvent()) return;
        if (event.data === YT.PlayerState.PLAYING) {
          socket.emit('playback:play', { position: player.getCurrentTime() || 0 });
        }
        if (event.data === YT.PlayerState.PAUSED) {
          socket.emit('playback:pause', { position: player.getCurrentTime() || 0 });
        }
        if (event.data === YT.PlayerState.ENDED) {
          socket.emit('track:next');
        }
      }
    }
  });
};

socket.on('room:state', (state) => {
  renderState(state);
  syncPlayer(state.playback);
});

socket.on('chat:new', appendChat);
socket.on('reaction:new', ({ emoji }) => spawnReaction(emoji));
socket.on('toast', ({ message }) => toast(message));
socket.on('playback:update', (payload) => {
  if (!latestState) return;
  latestState.playback.videoId = payload.videoId;
  latestState.playback.position = payload.position;
  if (payload.action === 'play') latestState.playback.isPlaying = true;
  if (payload.action === 'pause') latestState.playback.isPlaying = false;
  if (payload.action === 'load') latestState.playback.isPlaying = true;
  syncPlayer(latestState.playback);
});

els.joinBtn.onclick = () => {
  const room = (els.roomInput.value || 'main-room').trim();
  const name = (els.nameInput.value || `Khách ${Math.floor(Math.random() * 90 + 10)}`).trim();
  writeQuery(room, name);
  socket.emit('room:join', { roomId: room, name });
  joinedRoom = true;
  toast(`Đã vào phòng: ${room}`);
};

els.addBtn.onclick = () => {
  const payload = {
    url: els.urlInput.value.trim(),
    title: els.titleInput.value.trim()
  };
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }
  if (!payload.url) {
    toast('Nhập link YouTube hoặc videoId');
    return;
  }
  socket.emit('queue:add', payload);
  els.urlInput.value = '';
  els.titleInput.value = '';
};

els.sendBtn.onclick = () => {
  const text = els.chatInput.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  els.chatInput.value = '';
};

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.sendBtn.click();
});

els.playBtn.onclick = () => {
  if (!playerReady) return;
  socket.emit('playback:play', { position: player.getCurrentTime() || 0 });
};

els.pauseBtn.onclick = () => {
  if (!playerReady) return;
  socket.emit('playback:pause', { position: player.getCurrentTime() || 0 });
};

els.nextBtn.onclick = () => socket.emit('track:next');

document.querySelectorAll('[data-reaction]').forEach((btn) => {
  btn.addEventListener('click', () => {
    socket.emit('reaction:send', { emoji: btn.dataset.reaction });
  });
});

const initial = readQuery();
els.roomInput.value = initial.room;
els.nameInput.value = initial.name;
