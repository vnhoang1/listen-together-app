const socket = io();

const MAX_QUEUE_SIZE = 20;
const NEXT_EMIT_LOCK_MS = 2500;

let player = null;
let playerReady = false;
let playerCreated = false;
let latestState = null;
let joinedRoom = false;
let localUserUnlocked = false;
let suppressPlayerEventsUntil = 0;
let syncingFromServer = false;
let hiddenPauseGuardUntil = 0;
let nextTrackEmitLockedUntil = 0;
let lastLoadedVideoId = '';

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

function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getExpectedPosition(playback) {
  if (!playback || !playback.videoId) return 0;

  if (playback.isPlaying && playback.startedAt != null) {
    return Math.max(0, nowSec() - playback.startedAt);
  }

  return Math.max(0, playback.pausedAt || playback.position || 0);
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

function setSuppress(ms = 1200) {
  suppressPlayerEventsUntil = Date.now() + ms;
}

function isSuppressed() {
  return Date.now() < suppressPlayerEventsUntil;
}

function canEmitNextTrack() {
  return Date.now() >= nextTrackEmitLockedUntil;
}

function lockEmitNextTrack(ms = NEXT_EMIT_LOCK_MS) {
  nextTrackEmitLockedUntil = Date.now() + ms;
}

function requestNextTrack(reason = 'ended') {
  if (!joinedRoom) return;
  if (!canEmitNextTrack()) return;

  lockEmitNextTrack();
  console.log('[next track]', reason);
  socket.emit('track:next');
}

function updateHeader(playback, currentItem, usersCount) {
  const expected = Math.floor(getExpectedPosition(playback));

  if (!playback?.videoId) {
    els.trackMeta.textContent = 'Chưa có bài nào';
    els.statusBadge.textContent = 'Chưa phát';
    els.roomSummary.textContent = `${usersCount} người · Chưa có video`;
    return;
  }

  els.trackMeta.textContent = currentItem
    ? `${currentItem.title} · ${currentItem.addedBy} · ~${expected}s`
    : `Video ${playback.videoId} · ~${expected}s`;

  els.statusBadge.textContent = playback.isPlaying ? 'Đang phát' : 'Tạm dừng';
  els.roomSummary.textContent =
    `${usersCount} người · ${playback.isPlaying ? 'Đang phát' : 'Đang tạm dừng'} · ~${expected}s`;
}

function renderMembers(users = []) {
  els.memberList.innerHTML = users
    .map((u) => `<span class="member-chip">${escapeHtml(u.name)}</span>`)
    .join('');
}

function renderChat(chat = []) {
  els.chatList.innerHTML = chat
    .map((msg) => `
      <div class="chat-item">
        <div class="chat-head">
          <strong>${escapeHtml(msg.user)}</strong>
          <span>${escapeHtml(msg.time)}</span>
        </div>
        <div>${escapeHtml(msg.text)}</div>
      </div>
    `)
    .join('');

  els.chatList.scrollTop = els.chatList.scrollHeight;
}

function bindQueueActions() {
  els.queueList.querySelectorAll('[data-select-index]').forEach((node) => {
    node.onclick = () => {
      socket.emit('track:select', { index: Number(node.dataset.selectIndex) });
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
      socket.emit('queue:remove', { index: Number(node.dataset.remove) });
    };
  });
}

function renderQueue(queue = [], currentIndex = -1) {
  els.queueList.innerHTML = queue
    .map((item, index) => `
      <div class="queue-item ${index === currentIndex ? 'active' : ''}">
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

  bindQueueActions();
}

function showReaction(emoji) {
  const node = document.createElement('div');
  node.className = 'reaction-float';
  node.textContent = emoji;
  node.style.left = `${10 + Math.random() * 75}%`;
  els.reactions.appendChild(node);
  setTimeout(() => node.remove(), 1600);
}

function appendChatMessage(msg) {
  if (!latestState) return;
  latestState.chat = [...(latestState.chat || []), msg].slice(-100);
  renderChat(latestState.chat);
}

function loadRoomVideo(playback, forcePlay = false) {
  if (!playerReady || !playback?.videoId) return;

  const expected = getExpectedPosition(playback);
  const currentVideoId = getCurrentVideoId();

  syncingFromServer = true;
  setSuppress(1800);

  try {
    if (currentVideoId !== playback.videoId) {
      player.loadVideoById({
        videoId: playback.videoId,
        startSeconds: expected
      });
      lastLoadedVideoId = playback.videoId;
    } else {
      player.seekTo(expected, true);
    }
  } catch (_) {
    syncingFromServer = false;
    return;
  }

  const shouldPlay = forcePlay || (playback.isPlaying && localUserUnlocked);

  setTimeout(() => {
    try {
      if (shouldPlay) {
        player.playVideo();
      } else {
        player.pauseVideo();
      }
    } catch (_) {
      // ignore
    } finally {
      syncingFromServer = false;
    }
  }, 300);
}

function tryPlayCurrentSynced() {
  if (!playerReady) {
    toast('Player chưa sẵn sàng, thử lại sau 1 giây');
    return;
  }

  if (!latestState?.playback?.videoId) {
    toast('Phòng chưa có video');
    return;
  }

  localUserUnlocked = true;

  const playback = latestState.playback;
  const expected = getExpectedPosition(playback);
  const currentVideoId = getCurrentVideoId();

  syncingFromServer = true;
  setSuppress(1800);

  if (currentVideoId !== playback.videoId) {
    try {
      player.loadVideoById({
        videoId: playback.videoId,
        startSeconds: expected
      });
      lastLoadedVideoId = playback.videoId;
    } catch (_) {
      syncingFromServer = false;
      return;
    }

    setTimeout(() => {
      try {
        player.playVideo();
      } catch (_) {
        // ignore
      } finally {
        syncingFromServer = false;
      }
    }, 300);
  } else {
    try {
      player.seekTo(expected, true);
      player.playVideo();
    } catch (_) {
      // ignore
    } finally {
      setTimeout(() => {
        syncingFromServer = false;
      }, 300);
    }
  }

  socket.emit('playback:play', { position: expected });
}

function pauseCurrentSynced() {
  if (!playerReady || !latestState?.playback?.videoId) return;

  const position = getCurrentTimeSafe();

  syncingFromServer = true;
  setSuppress(1000);

  try {
    player.pauseVideo();
  } catch (_) {
    // ignore
  }

  setTimeout(() => {
    syncingFromServer = false;
  }, 250);

  socket.emit('playback:pause', { position });
}

function renderState(state) {
  latestState = state;

  const playback = state.playback || {};
  const queue = state.queue || [];
  const users = state.users || [];
  const currentItem = queue[state.currentIndex];

  renderQueue(queue, state.currentIndex);
  renderMembers(users);
  renderChat(state.chat || []);
  updateHeader(playback, currentItem, users.length);

  if (playerReady && playback.videoId) {
    const currentVideoId = getCurrentVideoId();
    if (currentVideoId !== playback.videoId) {
      loadRoomVideo(playback, false);
    }
  }
}

function createYoutubePlayer() {
  if (playerCreated) return;
  if (!window.YT || !window.YT.Player) return;

  const playerEl = document.getElementById('player');
  if (!playerEl) return;

  playerCreated = true;

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
        els.roomSummary.textContent = 'Player sẵn sàng';

        if (latestState?.playback?.videoId) {
          loadRoomVideo(latestState.playback, false);
        }
      },

      onStateChange: (event) => {
        if (isSuppressed()) return;
        if (!latestState?.playback?.videoId) return;

        const state = event.data;

        if (state === YT.PlayerState.ENDED) {
          requestNextTrack('ended');
          return;
        }

        if (syncingFromServer) return;

        // Không tự đồng bộ pause/play từ state change nữa.
        // Chỉ dùng nút Play / Tạm dừng để tránh lỗi minimize/background.
        if (state === YT.PlayerState.PLAYING) {
          return;
        }

        if (state === YT.PlayerState.PAUSED) {
          const hiddenRecently =
            document.hidden || Date.now() < hiddenPauseGuardUntil;

          if (hiddenRecently) {
            return;
          }

          return;
        }
      },

      onError: (event) => {
        console.error('YouTube error', event.data);

        const skippableErrors = [2, 5, 100, 101, 150];
        if (skippableErrors.includes(event.data)) {
          toast('Video này không phát được ở chế độ nhúng, đang chuyển bài tiếp theo.');
          requestNextTrack('error');
          return;
        }

        toast('Video này có thể không phát được ở chế độ nhúng.');
      }
    }
  });
}

window.onYouTubeIframeAPIReady = function () {
  createYoutubePlayer();
};

// Phòng trường hợp YouTube API đã load xong trước khi app.js chạy
if (window.YT && window.YT.Player) {
  createYoutubePlayer();
}

// Khi minimize / background, đừng để app hiểu nhầm là pause thật
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenPauseGuardUntil = Date.now() + 3000;
    setSuppress(1500);
  }
});

socket.on('connect', () => {
  console.log('[socket] connected', socket.id);
});

socket.on('disconnect', () => {
  els.roomSummary.textContent = 'Mất kết nối';
});

socket.on('toast', (payload) => {
  toast(payload?.message || 'Có lỗi xảy ra');
});

socket.on('room:state', (state) => {
  renderState(state);
});

socket.on('chat:new', (msg) => {
  appendChatMessage(msg);
});

socket.on('reaction:new', (payload) => {
  showReaction(payload?.emoji || '❤️');
});

socket.on('playback:update', (payload) => {
  if (!playerReady) return;
  if (!payload) return;

  const position = Math.max(0, Number(payload.position || 0));

  if (payload.action === 'load') {
    if (!payload.videoId) return;

    syncingFromServer = true;
    setSuppress(1800);
    lockEmitNextTrack();

    try {
      player.loadVideoById({
        videoId: payload.videoId,
        startSeconds: position
      });
      lastLoadedVideoId = payload.videoId;
    } catch (_) {
      syncingFromServer = false;
      return;
    }

    setTimeout(() => {
      try {
        if (localUserUnlocked) {
          player.playVideo();
        } else {
          player.pauseVideo();
        }
      } catch (_) {
        // ignore
      } finally {
        syncingFromServer = false;
      }
    }, 350);

    return;
  }

  if (!payload.videoId) return;

  if (payload.action === 'play') {
    syncingFromServer = true;
    setSuppress(1500);

    const currentVideoId = getCurrentVideoId();

    if (currentVideoId !== payload.videoId) {
      try {
        player.loadVideoById({
          videoId: payload.videoId,
          startSeconds: position
        });
        lastLoadedVideoId = payload.videoId;
      } catch (_) {
        syncingFromServer = false;
        return;
      }

      setTimeout(() => {
        try {
          if (localUserUnlocked) {
            player.playVideo();
          } else {
            player.pauseVideo();
          }
        } catch (_) {
          // ignore
        } finally {
          syncingFromServer = false;
        }
      }, 300);
    } else {
      try {
        player.seekTo(position, true);
        if (localUserUnlocked) {
          player.playVideo();
        }
      } catch (_) {
        // ignore
      } finally {
        setTimeout(() => {
          syncingFromServer = false;
        }, 250);
      }
    }

    return;
  }

  if (payload.action === 'pause') {
    syncingFromServer = true;
    setSuppress(1200);

    const currentVideoId = getCurrentVideoId();

    if (currentVideoId !== payload.videoId) {
      try {
        player.loadVideoById({
          videoId: payload.videoId,
          startSeconds: position
        });
        lastLoadedVideoId = payload.videoId;
      } catch (_) {
        syncingFromServer = false;
        return;
      }
    } else {
      try {
        player.seekTo(position, true);
      } catch (_) {
        // ignore
      }
    }

    setTimeout(() => {
      try {
        player.pauseVideo();
      } catch (_) {
        // ignore
      } finally {
        syncingFromServer = false;
      }
    }, 200);

    return;
  }

  if (payload.action === 'seek') {
    syncingFromServer = true;
    setSuppress(1000);

    const currentVideoId = getCurrentVideoId();

    if (currentVideoId !== payload.videoId) {
      try {
        player.loadVideoById({
          videoId: payload.videoId,
          startSeconds: position
        });
        lastLoadedVideoId = payload.videoId;
      } catch (_) {
        syncingFromServer = false;
        return;
      }

      setTimeout(() => {
        try {
          if (!latestState?.playback?.isPlaying || !localUserUnlocked) {
            player.pauseVideo();
          }
        } catch (_) {
          // ignore
        } finally {
          syncingFromServer = false;
        }
      }, 250);
    } else {
      try {
        player.seekTo(position, true);
      } catch (_) {
        // ignore
      } finally {
        setTimeout(() => {
          syncingFromServer = false;
        }, 200);
      }
    }
  }
});

els.joinBtn.onclick = () => {
  const roomId = (els.roomInput.value || 'main-room').trim() || 'main-room';
  const name = (els.nameInput.value || 'Khách').trim() || 'Khách';

  socket.emit('room:join', { roomId, name });
  joinedRoom = true;
  els.roomSummary.textContent = 'Đã vào phòng, đang tải player...';
};

els.addBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  if ((latestState?.queue || []).length >= MAX_QUEUE_SIZE) {
    toast(`Hàng chờ tối đa ${MAX_QUEUE_SIZE} bài`);
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

  tryPlayCurrentSynced();
};

els.pauseBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  pauseCurrentSynced();
};

els.nextBtn.onclick = () => {
  if (!joinedRoom) {
    toast('Bạn phải vào phòng trước');
    return;
  }

  requestNextTrack('manual');
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

// Resync nhẹ mỗi 3 giây để không bị lệch lâu
setInterval(() => {
  if (!playerReady || !latestState?.playback?.videoId) return;
  if (document.hidden) return;

  const playback = latestState.playback;
  const expected = getExpectedPosition(playback);
  const actual = getCurrentTimeSafe();
  const drift = Math.abs(expected - actual);

  const currentItem = latestState.queue?.[latestState.currentIndex];
  updateHeader(playback, currentItem, (latestState.users || []).length);

  if (playback.isPlaying && localUserUnlocked && drift > 2) {
    try {
      setSuppress(1000);
      player.seekTo(expected, true);
    } catch (_) {
      // ignore
    }
  }
}, 3000);
