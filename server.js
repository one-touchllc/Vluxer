// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const VLUXER_CONFIG = {
    GOOGLE_CLIENT_ID: "947590068056-86b58om05ii67fqfa0u2pls749qtii5g.apps.googleusercontent.com",
    SESSION_SECRET: "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",
    API_BASE_URL: "http://localhost:3000" // Aapka backend URL
};
require('dotenv').config();
const express        = require('express');
const http           = require('http');
const { Server }     = require('socket.io');
const session        = require('express-session');
const passport       = require('passport');
const flash          = require('connect-flash');
const path           = require('path');
const cors           = require('cors');

// ─── Route imports ────────────────────────────────────────────────────────────
const authRoutes     = require('./routes/auth');
const videoRoutes    = require('./routes/videos');
const uploadRoutes   = require('./routes/upload');
const userRoutes     = require('./routes/users');

// ─── Passport config ──────────────────────────────────────────────────────────
require('./middleware/passport')(passport);

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.APP_URL || 'http://localhost:3000', methods: ['GET','POST'] }
});

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'vluxer_dev_secret',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// ─── Global template locals ───────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.user          = req.user || null;
  res.locals.success_msg   = req.flash('success_msg');
  res.locals.error_msg     = req.flash('error_msg');
  res.locals.error         = req.flash('error');
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth',    authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/users',  userRoutes);

// Serve frontend for all other routes (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.io ────────────────────────────────────────────────────────────────
const liveViewers = {};   // { videoId: Set<socketId> }
const liveChats   = {};   // { videoId: [messages] }

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── JOIN VIDEO ROOM ──────────────────────────────────────────────────────
  socket.on('join-video', ({ videoId }) => {
    socket.join(`video:${videoId}`);
    if (!liveViewers[videoId]) liveViewers[videoId] = new Set();
    liveViewers[videoId].add(socket.id);

    // Broadcast updated viewer count to room
    io.to(`video:${videoId}`).emit('viewer-count', {
      videoId,
      count: liveViewers[videoId].size
    });

    // Send chat history to new joiner
    if (liveChats[videoId]) {
      socket.emit('chat-history', liveChats[videoId].slice(-50));
    }
    console.log(`[Socket] ${socket.id} joined video:${videoId} | viewers: ${liveViewers[videoId].size}`);
  });

  // ── LEAVE VIDEO ROOM ─────────────────────────────────────────────────────
  socket.on('leave-video', ({ videoId }) => {
    socket.leave(`video:${videoId}`);
    if (liveViewers[videoId]) {
      liveViewers[videoId].delete(socket.id);
      io.to(`video:${videoId}`).emit('viewer-count', {
        videoId,
        count: liveViewers[videoId].size
      });
    }
  });

  // ── LIVE CHAT MESSAGE ─────────────────────────────────────────────────────
  socket.on('send-message', ({ videoId, message, username, avatar }) => {
    if (!message || message.trim().length === 0) return;
    const msg = {
      id:       Date.now(),
      username: username || 'Anonymous',
      avatar:   avatar   || '👤',
      message:  message.trim().substring(0, 300),
      time:     new Date().toISOString()
    };
    if (!liveChats[videoId]) liveChats[videoId] = [];
    liveChats[videoId].push(msg);
    if (liveChats[videoId].length > 200) liveChats[videoId].shift(); // cap at 200
    io.to(`video:${videoId}`).emit('new-message', msg);
  });

  // ── UPLOAD PROGRESS (emit from upload route via io) ───────────────────────
  socket.on('subscribe-upload', ({ uploadId }) => {
    socket.join(`upload:${uploadId}`);
  });

  // ── LIKE / DISLIKE (real-time count update) ───────────────────────────────
  socket.on('like-video', ({ videoId }) => {
    io.to(`video:${videoId}`).emit('like-update', { videoId });
  });

  // ── DISCONNECT ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    // Remove from all rooms
    for (const videoId in liveViewers) {
      if (liveViewers[videoId].has(socket.id)) {
        liveViewers[videoId].delete(socket.id);
        io.to(`video:${videoId}`).emit('viewer-count', {
          videoId,
          count: liveViewers[videoId].size
        });
      }
    }
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// Export io so routes can emit events
app.set('io', io);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Vluxer running at http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✅ Configured' : '⚠️  Add CLIENT_ID to .env'}\n`);
});
