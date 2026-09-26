const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    content: {
      type: String,
      trim: true,
      default: "", // Default empty string so voice notes, files, and locations don't require text
    },
    chat: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Chat",
      required: true,
      index: true,
    },
    // Reference to the message being replied to (WhatsApp-style reply feature)
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    fileUrl: {
      type: String,
      default: "",
    },
    fileType: {
      type: String,
      enum: [
        "",
        "image",
        "document",
        "audio",
        "video",
        "location",
        "contact",
        "poll",
        "event",
        "call", // Added support for call notifications / missed calls
      ],
      default: "",
    },
    // Optional structured location data
    location: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String, default: "" },
    },
    // Optional structured poll data
    poll: {
      question: { type: String, default: "" },
      options: [
        {
          text: { type: String },
          votes: [
            {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
            },
          ],
        },
      ],
    },
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],
    // Tracks users who deleted this message for themselves only ("Delete for Me")
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // True when sender deletes for everyone ("Delete for Everyone")
    isDeleted: {
      type: Boolean,
      default: false,
    },
    // Fields to track text message edits (WhatsApp-style Edit feature)
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    reactions: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        emoji: {
          type: String,
          default: "",
        },
      },
    ],
    // Expiration timestamp for disappearing messages feature
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index for optimized conversation fetching ordered by time
messageSchema.index({ chat: 1, createdAt: 1 });

// Index for efficient unread message queries per chat and user
messageSchema.index({ chat: 1, sender: 1, readBy: 1 });

// TTL index for automatic disappearing messages cleanup
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

const Message = mongoose.model("Message", messageSchema);
module.exports = Message;