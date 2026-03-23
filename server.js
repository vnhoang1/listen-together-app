const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const YOUTUBE_API_KEY = "AIzaSyBJr_3237FdzC69XbvkxQSAMNdCRlG7pcU";

function extractVideoId(input) {
  if (!input) return '';
  const raw = String(input).trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;

  try {
    const url = new URL(raw);
    if (url.hostname.includes('youtu.be')) {
      return url.pathname.replace(/^\//, '').slice(0, 11);
    }
    const v = url.searchParams.get('v');
    if (v) return v.slice(0, 11);
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
    const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embed) return embed[1];
  } catch (_) {}
  return '';
}

async function fetchVideoTitle(videoId) {
  const urls = [
    `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'listen-together-app' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data.title === 'string' && data.title.trim()) {
        return data.title.trim();
      }
    } catch (_) {}
  }

  return `YouTube ${videoId}`;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function createRoom(roomId) {
  return {
    roomId,
    queue: [],
    currentIndex: -1,
    playback: {
      videoId: '',
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      updatedAt: nowSec()
    },
    chat: [],
    users: {}
  };
}

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    const room = createRoom(roomId);

    room.queue.push({
      id: Math.random().toString(36).slice(2, 10),
      videoId: 'jfKfPfyJRdk',
      title: 'Lofi hip hop radio',
      addedBy: 'System'
    });

    room.currentIndex = 0;
    room.playback = {
      videoId: 'jfKfPfyJRdk',
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      updatedAt: nowSec()
    };

    rooms.set(roomId, room);
  }

  return rooms.get(roomId);
}

function getPlaybackPosition(playback) {
  if (!playback.videoId) return 0;

  if (playback.isPlaying && playback.startedAt != null) {
    return Math.max(0, nowSec() - playback.startedAt);
  }

  return Math.max(0, playback.pausedAt || 0);
}

function syncState(room) {
  return {
    roomId: room.roomId,
    queue: room.queue,
    currentIndex: room.currentIndex,
    playback: {
      ...room.playback,
      position: getPlaybackPosition(room.playback)
    },
    chat: room.chat.slice(-100),
    users: Object.values(room.users)
  };
}

function broadcastRoom(roomId) {
  const room = getRoom(roomId);
  io.to(roomId).emit('room:state', syncState(room));
}

function moveToTrack(room, index, autoplay = true) {
  if (index < 0 || index >= room.queue.length) return;

  room.currentIndex = index;
  const item = room.queue[index];

  room.playback.videoId = item.videoId;
  room.playback.updatedAt = nowSec();

  if (autoplay) {
    room.playback.isPlaying = true;
    room.playback.startedAt = nowSec();
    room.playback.pausedAt = 0;
  } else {
    room.playback.isPlaying = false;
    room.playback.startedAt = null;
    room.playback.pausedAt = 0;
  }
}

function swapQueue(room, fromIndex, toIndex) {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= room.queue.length ||
    toIndex >= room.queue.length ||
    fromIndex === toIndex
  ) {
    return false;
  }

  const [moved] = room.queue.splice(fromIndex, 1);
  room.queue.splice(toIndex, 0, moved);

  if (room.currentIndex === fromIndex) {
    room.currentIndex = toIndex;
  } else if (fromIndex < room.currentIndex && toIndex >= room.currentIndex) {
    room.currentIndex -= 1;
  } else if (fromIndex > room.currentIndex && toIndex <= room.currentIndex) {
    room.currentIndex += 1;
  }

  return true;
}

function removeFromQueue(room, index) {
  if (index < 0 || index >= room.queue.length) return null;

  const [removed] = room.queue.splice(index, 1);

  if (room.queue.length === 0) {
    room.currentIndex = -1;
    room.playback = {
      videoId: '',
      isPlaying: false,
      startedAt: null,
      pausedAt: 0,
      updatedAt: nowSec()
    };
    return removed;
  }

  if (index < room.currentIndex) {
    room.currentIndex -= 1;
  } else if (index === room.currentIndex) {
    const nextIndex = Math.min(index, room.queue.length - 1);
    moveToTrack(room, nextIndex, true);
  }

  return removed;
}

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/youtube/search', async (req, res) => {
  const q = String(req.query.q || '').trim();

  if (!q) {
    return res.json({ items: [] });
  }

  try {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '10');
    url.searchParams.set('q', q);
    url.searchParams.set('key', YOUTUBE_API_KEY);

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'listen-together-app' }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('YouTube API error:', response.status, text);
      return res.status(500).json({ items: [] });
    }

    const data = await response.json();
    const items = (data.items || [])
      .map((item) => ({
        videoId: item?.id?.videoId || '',
        title: item?.snippet?.title || 'Không có tiêu đề',
        channelTitle: item?.snippet?.channelTitle || '',
        thumbnail:
          item?.snippet?.thumbnails?.medium?.url ||
          item?.snippet?.thumbnails?.default?.url ||
          ''
      }))
      .filter((item) => item.videoId);

    return res.json({ items });
  } catch (err) {
    console.error('YouTube search failed:', err);
    return res.status(500).json({ items: [] });
  }
});

io.on('connection', (socket) => {
  socket.on('room:join', ({ roomId, name }) => {
    const safeRoomId = String(roomId || 'main-room').trim() || 'main-room';
    const safeName = String(name || 'Khách').trim() || 'Khách';

    socket.data.roomId = safeRoomId;
    socket.data.name = safeName;

    socket.join(safeRoomId);

    const room = getRoom(safeRoomId);
    room.users[socket.id] = { id: socket.id, name: safeName };

    socket.emit('room:state', syncState(room));

    room.chat.push({
      id: Math.random().toString(36).slice(2, 10),
      user: 'System',
      text: `${safeName} đã vào phòng`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    broadcastRoom(safeRoomId);
  });

  socket.on('queue:add', async ({ url, title }) => {
    const roomId = socket.data.roomId;
    if (!roomId) {
      socket.emit('toast', { type: 'error', message: 'Bạn phải vào phòng trước' });
      return;
    }

    const room = getRoom(roomId);
    const videoId = extractVideoId(url);

    if (!videoId) {
      socket.emit('toast', { type: 'error', message: 'Link YouTube không hợp lệ' });
      return;
    }

    const resolvedTitle = String(title || '').trim() || await fetchVideoTitle(videoId);

    const item = {
      id: Math.random().toString(36).slice(2, 10),
      videoId,
      title: resolvedTitle,
      addedBy: socket.data.name || 'Khách'
    };

    room.queue.push(item);

    if (room.currentIndex === -1) {
      moveToTrack(room, 0, false);
    }

    room.chat.push({
      id: Math.random().toString(36).slice(2, 10),
      user: 'System',
      text: `${socket.data.name} đã thêm: ${resolvedTitle}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    broadcastRoom(roomId);
  });

  socket.on('queue:move', ({ fromIndex, toIndex }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const ok = swapQueue(room, Number(fromIndex), Number(toIndex));
    if (!ok) return;

    broadcastRoom(roomId);
  });

  socket.on('queue:remove', ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const removed = removeFromQueue(room, Number(index));
    if (!removed) return;

    room.chat.push({
      id: Math.random().toString(36).slice(2, 10),
      user: 'System',
      text: `${socket.data.name} đã xóa: ${removed.title}`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    io.to(roomId).emit('playback:update', {
      action: room.playback.videoId ? 'load' : 'pause',
      videoId: room.playback.videoId,
      position: getPlaybackPosition(room.playback),
      updatedAt: room.playback.updatedAt
    });

    broadcastRoom(roomId);
  });

  socket.on('track:select', ({ index }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    moveToTrack(room, Number(index), true);

    io.to(roomId).emit('playback:update', {
      action: 'load',
      videoId: room.playback.videoId,
      position: 0,
      updatedAt: room.playback.updatedAt
    });

    broadcastRoom(roomId);
  });

  socket.on('playback:play', ({ position }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const pos = Math.max(0, Number(position || 0));

    room.playback.isPlaying = true;
    room.playback.startedAt = nowSec() - pos;
    room.playback.pausedAt = 0;
    room.playback.updatedAt = nowSec();

    io.to(roomId).emit('playback:update', {
      action: 'play',
      videoId: room.playback.videoId,
      position: pos,
      updatedAt: room.playback.updatedAt
    });

    broadcastRoom(roomId);
  });

  socket.on('playback:pause', ({ position }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const pos = Math.max(0, Number(position || 0));

    room.playback.isPlaying = false;
    room.playback.pausedAt = pos;
    room.playback.startedAt = null;
    room.playback.updatedAt = nowSec();

    io.to(roomId).emit('playback:update', {
      action: 'pause',
      videoId: room.playback.videoId,
      position: pos,
      updatedAt: room.playback.updatedAt
    });

    broadcastRoom(roomId);
  });

  socket.on('playback:seek', ({ position }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const pos = Math.max(0, Number(position || 0));

    if (room.playback.isPlaying) {
      room.playback.startedAt = nowSec() - pos;
      room.playback.pausedAt = 0;
    } else {
      room.playback.pausedAt = pos;
    }

    room.playback.updatedAt = nowSec();

    io.to(roomId).emit('playback:update', {
      action: 'seek',
      videoId: room.playback.videoId,
      position: pos,
      updatedAt: room.playback.updatedAt
    });

    broadcastRoom(roomId);
  });

  socket.on('track:next', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);

    if (room.currentIndex < room.queue.length - 1) {
      moveToTrack(room, room.currentIndex + 1, true);

      io.to(roomId).emit('playback:update', {
        action: 'load',
        videoId: room.playback.videoId,
        position: 0,
        updatedAt: room.playback.updatedAt
      });

      broadcastRoom(roomId);
    }
  });

  socket.on('chat:send', ({ text }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const safeText = String(text || '').trim();
    if (!safeText) return;

    const msg = {
      id: Math.random().toString(36).slice(2, 10),
      user: socket.data.name || 'Khách',
      text: safeText,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    room.chat.push(msg);
    io.to(roomId).emit('chat:new', msg);
    broadcastRoom(roomId);
  });

  socket.on('reaction:send', ({ emoji }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    io.to(roomId).emit('reaction:new', {
      id: Math.random().toString(36).slice(2, 10),
      emoji: String(emoji || '❤️').slice(0, 4)
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;

    const room = getRoom(roomId);
    const name = socket.data.name || 'Khách';

    delete room.users[socket.id];

    room.chat.push({
      id: Math.random().toString(36).slice(2, 10),
      user: 'System',
      text: `${name} đã rời phòng`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });

    broadcastRoom(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
