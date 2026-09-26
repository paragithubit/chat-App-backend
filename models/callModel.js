const mongoose = require("mongoose");

const callSchema = mongoose.Schema(
  {
    caller: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false }, // Optional for group calls
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: "Chat", required: false }, // Links call to group or chat room
    isGroupCall: { type: Boolean, default: false },
    callType: { type: String, enum: ["audio", "video"], required: true },
    // Added "outgoing" and "incoming" to support call perspectives and prevent validation errors
    callStatus: { 
      type: String, 
      enum: ["completed", "missed", "rejected", "outgoing", "incoming"], 
      default: "completed" 
    },
    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

const Call = mongoose.model("Call", callSchema);
module.exports = Call;