const socket = io();

let player;
let playerReady = false;
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
  alert(message);
}

function nowSec() {
  return Date.now() / 1000;
}

function getExpectedPosition(playback) {
  if (!playback || !playback.videoId) return 0;

  if (playback.isPlaying && playback.startedAt != null) {
    return Math.max(0, nowSec() - playback.startedAt);
  }

  return Math.max(0, playback.pausedAt || playback.position || 0);
}

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getCurrentVideoId() {
  try {
    return player?.getVideoData?.().video_id || '';
  } catch {
    return '';
  }
}

function getCurrentTimeSafe() {
  try {
    return Number(player?.getCurrentTime?.() || 0);
  } catch {
    return 0;
  }
}

function renderState(state) {
  latestState = state;

  const playback = state.playback || {};
  const queue = state.queue || [];
  const users = state.users || [];
  const currentItem = queue[state.currentIndex];

  els.trackMeta.textContent = currentItem
    ? `${currentItem.title} · ${currentItem.addedBy} · ~${Math.floor(getExpectedPosition(playback))}s`
    : 'Chưa có bài nào';

  els.statusBadge.textContent = playback.isPlaying ? 'Đang phát' : 'Tạm dừng';
  els.roomSummary.textContent = `${users.length} người · ${playback.isPlaying ? 'Đang phát' : 'Đang tạm dừng'} · ~${Math.floor(getExpectedPosition(playback))}s`;

  els.memberList.innerHTML = users
    .map(u => `<span class="member-chip">${escapeHtml(u.name)}</span>`)
    .join('');

  els.chatList.innerHTML = (state.chat || [])
    .map(msg => `
      <div class="chat-item">
        <div class="chat-head">
          <strong>${escapeHtml(msg.user)}</strong>
          <span>${escapeHtml(msg.time)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      </div>
    `)
    .join('');

  els.queueList.innerHTML = queue
    .map((item, index) => `
      <div class="queue-item ${index === state.currentIndex ? 'active' : ''}">
        <div class="queue-main" data-select-index="${index}">
          <div class="queue-title">${index + 1}. ${escapeHtml(item.title)}</div>
          <div class="queue-meta">${escapeHtml(item.videoId)} · thêm bởi ${escapeHtml(item.addedBy)}</div>
        </div>
        <div class="queue-actions">
          <button data-move-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button data-move-down="${index}" ${index === queue.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-remove="${index}">Xóa</button>
        </div>
      </div>
    `)
    .join('');

  els.queueList.querySelectorAll('[data-select-index]').forEach(btn => {
    btn.onclick = () => socket.emit('track:select', { index: Number(btn.dataset.selectIndex) });
  });

  els.queueList.querySelectorAll('[data-move-up]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.moveUp);
      socket.emit('queue:move', { fromIndex: i, toIndex: i - 1 });
    };
  });

  els.queueList.querySelectorAll('[data-move-down]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.moveDown);
      socket.emit('queue:move', { fromIndex: i, toIndex: i + 1 });
    };
  });

  els.queueList.querySelectorAll('[data-remove]').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      socket.emit('queue:remove', { index: Number(btn.dataset.remove) });
    };
  });

  if (playerReady && playback.videoId) {
    const expected = getExpectedPosition(playback);
    const currentVideoId = getCurrentVideoId();

    if (currentVideoId !== playback.videoId) {
      player.loadVideoById({
        videoId: playback.videoId,
        startSeconds: expected
      });

      setTimeout(() => {
        try {
          player.pauseVideo();
        } catch {}
      }, 300);
    }
  }
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    width: '100%',
    height: '100%',
    videoId: '',
    playerVars: {
      autoplay: 0,
      controls: 1,
      rel: 0,
      playsinline: 1
    },
    events: {
      onReady: () => {
        playerReady = true;
        if (latestState?.playback?.videoId) {
          const expected = getExpectedPosition(latestState.playback);
          player.loadVideoById({
            videoId: latestState.playback.videoId,
            startSeconds: expected
          });
          setTimeout(() => {
            try {
              player.pauseVideo();
            } catch {}
          }, 300);
        }
      },
      onError: (e) => {
        console.error('YouTube error', e.data);
        toast('Video này có thể không phát được ở chế độ nhúng.');
      }
    }
  });
};

socket.on('room:state', (state) => {
  renderState(state);
});

socket.on('playback:update', (payload) => {
  if (!playerReady || !payload?.videoId) return;

  const currentVideoId = getCurrentVideoId();
  const position = Number(payload.position || 0);

  if (currentVideoId !== payload.videoId) {
    player.loadVideoById({
      videoId: payload.videoId,
      startSeconds: position
    });
  } else {
    player.seekTo(position, true);
  }

  if (payload.action === 'pause') {
    setTimeout(() => {
      try {
        player.pauseVideo();
      } catch {}
    }, 150);
  }
});

socket.on('chat:new', () => {});
socket.on('reaction:new', (payload) => {
  const node = document.createElement('div');
  node.className = 'reaction-float';
  node.textContent = payload?.emoji || '❤️';
  node.style.left = `${10 + Math.random() * 75}%`;
  els.reactions.appendChild(node);
  setTimeout(() => node.remove(), 1600);
});

socket.on('toast', (payload) => {
  toast(payload?.message || 'Có lỗi');
});

els.joinBtn.onclick = () => {
  const roomId = (els.roomInput.value || 'main-room').trim() || 'main-room';
  const name = (els.nameInput.value || 'Khách').trim() || 'Khách';
  socket.emit('room:join', { roomId, name });
  joinedRoom = true;
};

els.addBtn.onclick = () => {
  if (!joinedRoom) return toast('Bạn phải vào phòng trước');
  const url = (els.urlInput.value || '').trim();
  const title = (els.titleInput.value || '').trim();
  if (!url) return toast('Bạn chưa nhập link YouTube');
  socket.emit('queue:add', { url, title });
  els.urlInput.value = '';
  els.titleInput.value = '';
};

els.sendBtn.onclick = () => {
  if (!joinedRoom) return toast('Bạn phải vào phòng trước');
  const text = (els.chatInput.value || '').trim();
  if (!text) return;
  socket.emit('chat:send', { text });
  els.chatInput.value = '';
};

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.sendBtn.click();
});

els.playBtn.onclick = () => {
  if (!joinedRoom) return toast('Bạn phải vào phòng trước');
  if (!playerReady) return toast('Player chưa sẵn sàng');
  if (!latestState?.playback?.videoId) return toast('Chưa có video');

  const expected = getExpectedPosition(latestState.playback);
  const currentVideoId = getCurrentVideoId();

  if (currentVideoId !== latestState.playback.videoId) {
    player.loadVideoById({
      videoId: latestState.playback.videoId,
      startSeconds: expected
    });

    setTimeout(() => {
      try {
        player.playVideo();
      } catch {}
    }, 300);
  } else {
    player.seekTo(expected, true);
    player.playVideo();
  }

  socket.emit('playback:play', { position: expected });
};

els.pauseBtn.onclick = () => {
  if (!joinedRoom) return toast('Bạn phải vào phòng trước');
  if (!playerReady) return;

  const position = getCurrentTimeSafe();
  try {
    player.pauseVideo();
  } catch {}
  socket.emit('playback:pause', { position });
};

els.nextBtn.onclick = () => {
  if (!joinedRoom) return toast('Bạn phải vào phòng trước');
  socket.emit('track:next');
};

document.querySelectorAll('[data-reaction]').forEach(btn => {
  btn.onclick = () => {
    if (!joinedRoom) return toast('Bạn phải vào phòng trước');
    socket.emit('reaction:send', { emoji: btn.dataset.reaction });
  };
});

setInterval(() => {
  if (!latestState?.playback?.videoId || !playerReady) return;

  const expected = getExpectedPosition(latestState.playback);
  const actual = getCurrentTimeSafe();

  if (latestState.playback.isPlaying && Math.abs(expected - actual) > 2) {
    try {
      player.seekTo(expected, true);
    } catch {}
  }

  if (latestState) {
    els.trackMeta.textContent = els.trackMeta.textContent.replace(/~\d+s$/, `~${Math.floor(expected)}s`);
    els.roomSummary.textContent =
      `${(latestState.users || []).length} người · ${latestState.playback.isPlaying ? 'Đang phát' : 'Đang tạm dừng'} · ~${Math.floor(expected)}s`;
  }
}, 3000);
