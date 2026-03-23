const socket = io();

const els = {
  nameInput: document.getElementById('nameInput'),
  roomInput: document.getElementById('roomInput'),
  joinBtn: document.getElementById('joinBtn'),
  urlInput: document.getElementById('urlInput'),
  titleInput: document.getElementById('titleInput'),
  addBtn: document.getElementById('addBtn'),
  queueList: document.getElementById('queueList'),
  chatList: document.getElementById('chatList'),
  chatInput: document.getElementById('chatInput'),
  sendBtn: document.getElementById('sendBtn'),
  memberList: document.getElementById('memberList'),
  playBtn: document.getElementById('playBtn'),
  pauseBtn: document.getElementById('pauseBtn'),
  nextBtn: document.getElementById('nextBtn'),
  trackMeta: document.getElementById('trackMeta'),
  statusBadge: document.getElementById('statusBadge'),
  roomSummary: document.getElementById('roomSummary'),
  reactions: document.getElementById('reactions')
};

let joinedRoom = '';
let player = null;
let playerReady = false;
let latestState = null;
let localUserInteracted = false;
let ignorePlayerStateUntil = 0;
let syncTimer = null;

function nowSec() {
  return Date.now() / 1000;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toast(message) {
  alert(message);
}

function getExpectedPosition(playback) {
  if (!playback || !playback.videoId) return 0;

  if (playback.isPlaying && playback.startedAt != null) {
    return Math.max(0, nowSec() - playback.startedAt);
  }

  return Math.max(0, playback.pausedAt || playback.position || 0);
}

function getPlayerTime() {
  try {
    if (!playerReady || !player || typeof player.getCurrentTime !== 'function') return 0;
    const t = Number(player.getCurrentTime() || 0);
    return Number.isFinite(t) ? t : 0;
  } catch (_) {
    return 0;
  }
}

function getCurrentVideoId() {
  try {
    if (!playerReady || !player || typeof player.getVideoData !== 'function') return '';
    return player.getVideoData()?.video_id || '';
  } catch (_) {
    return '';
  }
}

function hasRoomPlayback() {
  return !!(latestState && latestState.playback && latestState.playback.videoId);
}

function setStatus(text) {
  els.statusBadge.textContent = text;
}

function updateRoomSummary() {
  if (!latestState) {
    els.roomSummary.textContent = 'Chưa kết nối';
    return;
  }

  const playback = latestState.playback || {};
  const users = latestState.users || [];
  const pos = Math.floor(getExpectedPosition(playback));

  if (!playback.videoId) {
    els.roomSummary.textContent = `${users.length} người · Chưa có video`;
    return;
  }

  els.roomSummary.textContent =
    `${users.length} người · ${playback.isPlaying ? 'Đang phát' : 'Đang tạm dừng'} · ~${pos}s`;
}

function renderMembers(users = []) {
  els.memberList.innerHTML = users
    .map((u) => `<span class="member-chip">${escapeHtml(u.name)}</span>`)
    .join('');
}

function renderChat(chat = []) {
  els.chatList.innerHTML = chat
    .map((msg) => {
      return `
        <div class="chat-item">
          <div class="chat-head">
            <strong>${escapeHtml(msg.user)}</strong>
            <span>${escapeHtml(msg.time)}</span>
          </div>
          <div>${escapeHtml(msg.text)}</div>
        </div>
      `;
    })
    .join('');

  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function renderQueue(queue = [], currentIndex = -1) {
  els.queueList.innerHTML = queue
    .map((item, index) => {
      const isCurrent = index === currentIndex;

      return `
        <div class="queue-item ${isCurrent ? 'active' : ''}">
          <div class="queue-main" data-select-index="${index}">
            <div class="queue-title">${index + 1}. ${escapeHtml(item.title)}</div>
            <div class="queue-meta">
              ${escapeHtml(item.videoId)} · thêm bởi ${escapeHtml(item.addedBy)}
            </div>
          </div>

          <div class="queue-actions">
            <button data-move-up="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button data-move-down="${index}" ${index === queue.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-remove="${index}">Xóa</button>
          </div>
        </div>
      `;
    })
    .join('');

  els.queueList.querySelectorAll('[data-select-index]').forEach((node) => {
    node.onclick = () => {
      const index = Number(node.dataset.selectIndex);
      socket.emit('track:select', { index });
    };
  });

  els.queueList.querySelectorAll('[data-move-up]').forEach((node) => {
    node.onclick = (e) => {
      e.stopPropagation();
      const index = Number(node.dataset.moveUp);
      socket.emit('queue:move', { fromIndex: index, toIndex: index - 1 });
    };
  });

  els.queueList.querySelectorAll('[data-move-down]').forEach((node) => {
    node.onclick = (e) => {
      e.stopPropagation();
      const index = Number(node.dataset.moveDown);
      socket.emit('queue:move', { fromIndex: index, toIndex: index + 1 });
    };
  });

  els.queueList.querySelectorAll('[data-remove]').forEach((node) => {
    node.onclick = (e) => {
      e.stopPropagation();
      const index = Number(node.dataset.remove);
      socket.emit('queue:remove', { index });
    };
  });
}

function updateTrackMeta() {
  if (!latestState || !latestState.playback?.videoId) {
    els.trackMeta.textContent = 'Chưa có bài nào';
    setStatus('Chưa phát');
    return;
  }

  const item = latestState.queue?.[latestState.currentIndex];
  const expected = Math.floor(getExpectedPosition(latestState.playback));

  els.trackMeta.textContent = item
    ? `${item.title} · ${item.addedBy} · ~${expected}s`
    : `Video ${latestState.playback.videoId} · ~${expected}s`;

  setStatus(latestState.playback.isPlaying ? 'Đang phát' : 'Tạm dừng');
}

function loadVideoForRoom(playback) {
  if (!playerReady || !playback || !playback.videoId) return;

  const currentVideoId = getCurrentVideoId();
  const expected = getExpectedPosition(playback);

  ignorePlayerStateUntil = Date.now() + 1500;

  if (currentVideoId !== playback.videoId) {
    player.loadVideoById({
      videoId: playback.videoId,
      startSeconds: expected
    });

    if (!localUserInteracted || !playback.isPlaying) {
      setTimeout(() => {
        try {
          player.pauseVideo();
        } catch (_) {}
      }, 300);
    }

    return;
  }

  try {
    player.seekTo(expected, true);
  } catch (_) {}
}

function tryPlaySynced() {
  if (!playerReady || !hasRoomPlayback()) return;

  localUserInteracted = true;

  const playback = latestState.playback;
  const expected = getExpectedPosition(playback);

  ignorePlayerStateUntil = Date.now() + 1500;

  try {
    const currentVideoId = getCurrentVideoId();

    if (currentVideoId !== playback.videoId) {
      player.loadVideoById({
        videoId: playback.videoId,
        startSeconds: expected
      });
    } else {
      player.seekTo(expected, true);
      player.playVideo();
    }
  } catch (err) {
    console.error('[play error]', err);
  }

  setTimeout(() => {
    try {
      player.playVideo();
    } catch (_) {}
  }, 250);

  socket.emit('playback:play', { position: expected });
}

function pauseSynced() {
  if (!playerReady || !hasRoomPlayback()) return;

  const position = getPlayerTime();

  ignorePlayerStateUntil = Date.now() + 1000;

  try {
    player.pauseVideo();
  } catch (_) {}

  socket.emit('playback:pause', { position });
}

function seekIfDrifted() {
  if (!playerReady || !hasRoomPlayback()) return;
  if (!latestState.playback.isPlaying) return;
  if (!localUserInteracted) return;

  const expected = getExpectedPosition(latestState.playback);
  const actual = getPlayerTime();
  const drift = Math.abs(actual - expected);

  if (drift > 1.5) {
    ignorePlayerStateUntil = Date.now() + 1000;
    try {
      player.seekTo(expected, true);
    } catch (_) {}
  }
}

function handleRoomState(state) {
  latestState = state;

  renderQueue(state.queue || [], state.currentIndex);
  renderChat(state.chat || []);
  renderMembers(state.users || []);
  updateTrackMeta();
  updateRoomSummary();

  if (playerReady && state.playback?.videoId) {
    const currentVideoId = getCurrentVideoId();
    if (currentVideoId !== state.playback.videoId) {
      loadVideoForRoom(state.playback);
    }
  }
}

function appendChatMessage(msg) {
  const current = latestState?.chat || [];
  current.push(msg);

  if (latestState) {
    latestState.chat = current.slice(-100);
  }

  renderChat(latestState?.chat || []);
}

function showReaction(emoji) {
  const node = document.createElement('div');
  node.className = 'reaction-float';
  node.textContent = emoji;
  node.style.left = `${10 + Math.random() * 75}%`;
  els.reactions.appendChild(node);

  setTimeout(() => {
    node.remove();
  }, 1600);
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
      modestbranding: 1,
      playsinline: 1
    },
    events: {
      onReady: () => {
        playerReady = true;
        console.log('[YT] ready');

        if (latestState?.playback?.videoId) {
          loadVideoForRoom(latestState.playback);
        }
      },
      onStateChange: (event) => {
        if (Date.now() < ignorePlayerStateUntil) return;

        if (!latestState?.playback?.videoId) return;

        const state = event.data;
        const now = getPlayerTime();

        if (state === YT.PlayerState.PAUSED) {
          if (latestState.playback.isPlaying && localUserInteracted) {
            socket.emit('playback:pause', { position: now });
          }
        }

        if (state === YT.PlayerState.PLAYING) {
          if (!latestState.playback.isPlaying && localUserInteracted) {
            socket.emit('playback:play', { position: now });
          }
        }
      },
      onError: (event) => {
        console.error('[YT error]', event.data);
        toast(`YouTube lỗi phát video: ${event.data}`);
      }
    }
  });
};

socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
});

socket.on('disconnect', () => {
  console.log('[socket] disconnected');
  els.roomSummary.textContent = 'Mất kết nối';
});

socket.on('toast', (payload) => {
  toast(payload?.message || 'Có lỗi xảy ra');
});

socket.on('room:state', (state) => {
  console.log('[room:state]', state);
  handleRoomState(state);
});

socket.on('chat:new', (msg) => {
  appendChatMessage(msg);
});

socket.on('reaction:new', (payload) => {
  showReaction(payload?.emoji || '❤️');
});

socket.on('playback:update', (payload) => {
  console.log('[playback:update]', payload);

  if (!playerReady || !payload?.videoId) return;

  const currentVideoId = getCurrentVideoId();
  const position = Math.max(0, Number(payload.position || 0));

  ignorePlayerStateUntil = Date.now() + 1500;

  if (payload.action === 'load') {
    player.loadVideoById({
      videoId: payload.videoId,
      startSeconds: position
    });

    if (!localUserInteracted) {
      setTimeout(() => {
        try {
          player.pauseVideo();
        } catch (_) {}
      }, 300);
    }
    return;
  }

  if (payload.action === 'play') {
    if (currentVideoId !== payload.videoId) {
      player.loadVideoById({
        videoId: payload.videoId,
        startSeconds: position
      });

      if (!localUserInteracted) {
        setTimeout(() => {
          try {
            player.pauseVideo();
          } catch (_) {}
        }, 300);
      }
      return;
    }

    player.seekTo(position, true);

    if (localUserInteracted) {
      player.playVideo();
    }
    return;
  }

  if (payload.action === 'pause') {
    if (currentVideoId !== payload.videoId) {
      player.loadVideoById({
        videoId: payload.videoId,
        startSeconds: position
      });
    } else {
      player.seekTo(position, true);
    }

    setTimeout(() => {
      try {
        player.pauseVideo();
      } catch (_) {}
    }, 150);
    return;
  }

  if (payload.action === 'seek') {
    if (currentVideoId !== payload.videoId) {
      player.loadVideoById({
        videoId: payload.videoId,
        startSeconds: position
      });

      if (!localUserInteracted || !latestState?.playback?.isPlaying) {
        setTimeout(() => {
          try {
            player.pauseVideo();
          } catch (_) {}
        }, 300);
      }
      return;
    }

    player.seekTo(position, true);
  }
});

els.joinBtn.onclick = () => {
  const roomId = (els.roomInput.value || 'main-room').trim() || 'main-room';
  const name = (els.nameInput.value || 'Khách').trim() || 'Khách';

  joinedRoom = roomId;
  socket.emit('room:join', { roomId, name });
};

els.addBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  const url = (els.urlInput.value || '').trim();
  const title = (els.titleInput.value || '').trim();

  if (!url) {
    toast('Bạn chưa nhập link YouTube');
    return;
  }

  socket.emit('queue:add', { url, title });

  els.urlInput.value = '';
  els.titleInput.value = '';
};

els.sendBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  const text = (els.chatInput.value || '').trim();
  if (!text) return;

  socket.emit('chat:send', { text });
  els.chatInput.value = '';
};

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    els.sendBtn.click();
  }
});

els.playBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  if (!hasRoomPlayback()) {
    toast('Phòng chưa có video nào');
    return;
  }

  tryPlaySynced();
};

els.pauseBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  pauseSynced();
};

els.nextBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  socket.emit('track:next');
};

document.querySelectorAll('[data-reaction]').forEach((node) => {
  node.onclick = () => {
    if (!joinedRoom) {
      toast('Bạn phải vào phòng trước');
      return;
    }

    socket.emit('reaction:send', { emoji: node.dataset.reaction });
  };
});

syncTimer = setInterval(() => {
  try {
    seekIfDrifted();
    updateTrackMeta();
    updateRoomSummary();
  } catch (err) {
    console.error('[sync timer]', err);
  }
}, 3000);
