const mongoose = require("mongoose");

const statusSchema = mongoose.Schema(
  {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    content: { 
      type: String, 
      trim: true 
    },
    mediaUrl: { 
      type: String 
    },
    mediaType: { 
      type: String, 
      enum: ["image", "video", "text"], 
      default: "text" 
    },
    viewedBy: [
      { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User" 
      }
    ], // Tracks users who have viewed this status
    expiresAt: { 
      type: Date, 
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000), 
      index: { expires: '0s' } // MongoDB TTL index automatically deletes documents after 24 hours
    },
  },
  { timestamps: true }
);

// Optional validator to ensure a status has either text content or media attached
statusSchema.path('mediaUrl').validate(function (value) {
  return !!(value || this.content);
}, 'A status must contain either text content or media.');

const Status = mongoose.model("Status", statusSchema);
module.exports = Status;