
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

// Connect to MongoDB
connectDB();

const authRoutes = require("./routes/authRoutes");
const chatRoutes = require("./routes/chatRoutes");
const messageRoutes = require("./routes/messageRoutes");
const userRoutes = require("./routes/userRoutes");
const callRoutes = require("./routes/callRoutes");
const statusRoutes = require("./routes/statusRoutes");
const aiRoutes = require("./routes/aiRoutes");
const contactRoutes = require("./routes/contactRoutes");
const otpRoutes = require("./routes/otpRoutes");

const User = require("./models/User");
const Call = require("./models/callModel");
const Message = require("./models/Message");

const app = express();

// Allowed Origins (Vite and CRA ports)
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

// Global CORS Middleware
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Body parser with expanded limits
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Routes Mounting
app.use("/api/auth", authRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);
app.use("/api/users", userRoutes);
app.use("/api/user", userRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/status", statusRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/contacts", contactRoutes);
app.use("/api/otp", otpRoutes);

// Base Test Route
app.get("/", (req, res) => {
  res.json({
    message: "Chat Server is running 🚀",
  });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  console.error("🔥 Global Server Error Caught:", err.stack || err);
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(statusCode).json({
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  });
});

// Create HTTP Server for Socket.io
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  pingTimeout: 60000,
  maxHttpBufferSize: 100 * 1024 * 1024,
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

// Attach Socket.io instance to Express app
app.set("io", io);

// Track active online users: Map of { userId: socketId }
const onlineUsers = new Map();

// Track active participants in group calls: Map of { chatId: Set(socketId) }
const activeCallRooms = new Map();

// Unified Socket.io Connection Logic
io.on("connection", (socket) => {
  console.log(`⚡ Connected to Socket.io: ${socket.id}`);

  socket.setupUserData = null;

  socket.on("setup", (userData) => {
    const userId = (userData?._id || userData?.id || userData)?.toString();
    if (!userId) return;

    socket.setupUserData = userId;
    socket.join(userId);
    onlineUsers.set(userId, socket.id);

    console.log(`User online & joined personal room: ${userId}`);

    io.emit("get online users", Array.from(onlineUsers.keys()));
    socket.emit("connected");
  });

  socket.on("join chat", (room) => {
    if (!room) return;
    const roomId = room.toString();
    socket.join(roomId);
    console.log(`User joined chat room: ${roomId}`);
  });

  socket.on("leave chat room", (room) => {
    if (!room) return;
    const roomId = room.toString();
    socket.leave(roomId);
    console.log(`User left chat room: ${roomId}`);
  });

  socket.on("typing", (room) => {
    if (!room) return;
    socket.to(room.toString()).emit("typing");
  });

  socket.on("stop typing", (room) => {
    if (!room) return;
    socket.to(room.toString()).emit("stop typing");
  });

  socket.on("mark as read", ({ chatId, userId }) => {
    if (!chatId) return;
    socket.to(chatId.toString()).emit("messages read", { chatId, userId });
  });

  socket.on("delete message", ({ messageId, chatId, isForEveryone = true }) => {
    if (!chatId || !isForEveryone) return;
    socket.to(chatId.toString()).emit("message deleted", { messageId, chatId });
  });

  socket.on("edit message", (updatedMessage) => {
    const chatId = (updatedMessage.chat?._id || updatedMessage.chat)?.toString();
    if (!chatId) return;
    socket.to(chatId).emit("message edited", updatedMessage);
  });

  socket.on("react message", (updatedMessage) => {
    const chatId = (updatedMessage.chat?._id || updatedMessage.chat)?.toString();
    if (!chatId) return;
    io.to(chatId).emit("message reacted", updatedMessage);
  });

  socket.on("new message", (newMessageReceived) => {
    const chat = newMessageReceived?.chat;

    if (!chat || !chat.users) return console.log("chat.users not defined");

    const senderId = (
      newMessageReceived.sender?._id ||
      newMessageReceived.sender?.id ||
      newMessageReceived.sender
    )?.toString();

    chat.users.forEach((user) => {
      const recipientId = (user?._id || user?.id || user)?.toString();

      if (!recipientId || recipientId === senderId) return;

      io.to(recipientId).emit("message received", newMessageReceived);
    });
  });

  // =======================================================
  // WebRTC Calling Signaling Handlers (1-on-1 + Group Calls)
  // =======================================================
  socket.on("callUser", async ({ userToCall, usersToCall, signalData, from, callType, chatId, isGroupCall, groupName }) => {
    const callerId = (from?._id || from?.id || from)?.toString();
    const resolvedUserToCall = (userToCall?._id || userToCall?.id || userToCall)?.toString();

    if (isGroupCall) {
      if (chatId) {
        const roomKey = chatId.toString();
        socket.join(`call-${roomKey}`);

        if (!activeCallRooms.has(roomKey)) {
          activeCallRooms.set(roomKey, new Set());
        }
        activeCallRooms.get(roomKey).add(socket.id);
      }

      try {
        await Call.create({
          caller: callerId,
          receiver: null,
          chatId: chatId || null,
          isGroupCall: true,
          callType: callType || "video",
          callStatus: "completed",
        });
      } catch (err) {
        console.error("Failed to log group call history:", err);
      }

      const targetUsers = usersToCall || [];
      targetUsers.forEach((recipient) => {
        const recipientId = (recipient?._id || recipient?.id || recipient)?.toString();
        if (recipientId && recipientId !== callerId) {
          io.to(recipientId).emit("incomingCall", {
            signal: signalData,
            from,
            fromSocketId: socket.id,
            callType: callType || "video",
            chatId,
            isGroupCall: true,
            groupName: groupName || "Group Call",
          });
        }
      });
      return; 
    } 

    if (resolvedUserToCall) {
      io.to(resolvedUserToCall).emit("incomingCall", {
        signal: signalData,
        from,
        fromSocketId: socket.id,
        callType: callType || "video",
        chatId: null,
        isGroupCall: false,
      });
    }
  });

  socket.on("answerCall", async ({ to, signal, chatId, callerId, receiverId, callType }) => {
    const targetId = (to?._id || to?.id || to)?.toString();
    
    if (callerId && receiverId && !chatId) {
      try {
        await Call.create({
          caller: callerId,
          receiver: receiverId,
          chatId: null,
          isGroupCall: false,
          callType: callType || "video",
          callStatus: "completed",
        });
      } catch (err) {
        console.error("Failed to log answered call history:", err);
      }
    }

    if (chatId) {
      const roomKey = chatId.toString();
      socket.join(`call-${roomKey}`);

      if (!activeCallRooms.has(roomKey)) {
        activeCallRooms.set(roomKey, new Set());
      }
      activeCallRooms.get(roomKey).add(socket.id);
    }

    if (targetId) {
      io.to(targetId).emit("callAccepted", { signal, from: socket.id });
    }
  });

  socket.on("iceCandidate", ({ to, candidate, chatId }) => {
    const targetId = (to?._id || to?.id || to)?.toString();
    if (targetId) {
      io.to(targetId).emit("iceCandidate", { candidate, from: socket.id });
    } else if (chatId) {
      socket.to(`call-${chatId}`).emit("iceCandidate", { candidate, from: socket.id });
    }
  });

  // End Call Handler with Robust Fallback Missed Call Logging
  socket.on("endCall", async ({ to, chatId, callerId, receiverId, callType, wasAnswered }) => {
    const targetId = (to?._id || to?.id || to)?.toString() || to;
    const currentUserId = socket.setupUserData;
    
    const resolvedCallerId = callerId || currentUserId;
    const resolvedReceiverId = receiverId || targetId;
    
    if (resolvedCallerId && resolvedReceiverId && !wasAnswered && !chatId && resolvedCallerId !== resolvedReceiverId) {
      try {
        await Call.create({
          caller: resolvedCallerId,
          receiver: resolvedReceiverId,
          chatId: null,
          isGroupCall: false,
          callType: callType || "video",
          callStatus: "missed",
        });
        console.log("📞 Missed call logged successfully in DB!");
      } catch (err) {
        console.error("Failed to log missed call:", err);
      }
    }

    if (chatId) {
      const roomKey = chatId.toString();
      const roomParticipants = activeCallRooms.get(roomKey);

      if (roomParticipants) {
        roomParticipants.delete(socket.id);
        socket.leave(`call-${roomKey}`);

        if (roomParticipants.size === 1) {
          const remainingSocketId = Array.from(roomParticipants)[0];
          io.to(remainingSocketId).emit("callEnded");
          activeCallRooms.delete(roomKey);
        } else if (roomParticipants.size > 1) {
          socket.to(`call-${roomKey}`).emit("userLeftCall", {
            socketId: socket.id,
            chatId,
          });
        } else {
          activeCallRooms.delete(roomKey);
        }
      } else {
        socket.leave(`call-${roomKey}`);
        socket.to(`call-${roomKey}`).emit("userLeftCall", {
          socketId: socket.id,
          chatId,
        });
      }

      if (targetId) {
        io.to(targetId).emit("userLeftCall", { socketId: socket.id, chatId });
      }
    } else if (targetId) {
      io.to(targetId).emit("callEnded");
    }
  });

  socket.on("disconnect", async () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    for (const [roomKey, participants] of activeCallRooms.entries()) {
      if (participants.has(socket.id)) {
        participants.delete(socket.id);

        if (participants.size === 1) {
          const remainingSocketId = Array.from(participants)[0];
          io.to(remainingSocketId).emit("callEnded");
          activeCallRooms.delete(roomKey);
        } else if (participants.size > 1) {
          socket.to(`call-${roomKey}`).emit("userLeftCall", {
            socketId: socket.id,
            chatId: roomKey,
          });
        } else {
          activeCallRooms.delete(roomKey);
        }
      }
    }

    let disconnectedUserId = socket.setupUserData || null;

    if (!disconnectedUserId) {
      for (let [userId, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          disconnectedUserId = userId;
          break;
        }
      }
    }

    if (disconnectedUserId) {
      onlineUsers.delete(disconnectedUserId);
      const now = new Date();

      try {
        await User.findByIdAndUpdate(disconnectedUserId, { lastSeen: now });
      } catch (err) {
        console.error("Failed to update last seen timestamp:", err);
      }

      io.emit("user offline", {
        userId: disconnectedUserId,
        lastSeen: now,
      });
    }

    io.emit("get online users", Array.from(onlineUsers.keys()));
  });
});

// Background Worker: Cleanup expired disappearing messages every 60 seconds
setInterval(async () => {
  try {
    const expiredMessages = await Message.find({
      expiresAt: { $ne: null,$lte: new Date() },
    });

    if (expiredMessages.length > 0) {
      for (const msg of expiredMessages) {
        const chatId = msg.chat?.toString();
        const messageId = msg._id?.toString();

        Message.findByIdAndDelete(messageId).catch(() => {});

        if (chatId) {
          io.to(chatId).emit("message deleted", { messageId, chatId });
        }
      }
    }
  } catch (err) {
    console.error("Error running disappearing messages cleanup job:", err);
  }
}, 60000);

const PORT = process.env.PORT || 7000;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});