const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  phoneNumber: { type: String, required: true },
  otpCode: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // Auto-deletes document after 300 seconds (5 mins)
});

module.exports = mongoose.model("Otp", otpSchema);