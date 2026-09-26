const mongoose = require("mongoose");

const chatSchema = new mongoose.Schema(
  {
    chatName: {
      type: String,
      trim: true,
      default: "sender",
    },
    isGroupChat: {
      type: Boolean,
      default: false,
    },
    // Flag to identify dedicated standalone AI Assistant / Meta AI chat rooms
    isAIBot: {
      type: Boolean,
      default: false,
      index: true,
    },
    groupImage: {
      type: String,
      default: "", // Cloudinary URL for group profile photo or AI bot avatar
    },
    groupDescription: {
      type: String,
      trim: true,
      default: "",
    },
    users: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    latestMessage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    // Allows multiple admins like real WhatsApp
    groupAdmin: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Map to track unread message counts per user ID in this chat
    unreadCounts: {
      type: Map,
      of: Number,
      default: {},
    },
    // NEW: Users who have marked this chat as a favourite
    favouriteBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Disappearing Messages configuration (Duration in seconds, or 0 / null for Off)
    disappearingMessages: {
      duration: {
        type: Number,
        default: 0, 
      },
      enabledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes to optimize sidebar chat queries
chatSchema.index({ users: 1, updatedAt: -1 });
chatSchema.index({ favouriteBy: 1 });

const Chat = mongoose.model("Chat", chatSchema);
module.exports = Chat;