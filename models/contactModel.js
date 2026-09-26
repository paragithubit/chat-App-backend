const mongoose = require("mongoose");

const contactSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    contactUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional so unregistered numbers can still be saved
    },
    savedName: {
      type: String,
      required: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Helper: Normalize phone numbers to clean 10 digits before saving (Synchronous hook, no next parameter)
contactSchema.pre("validate", function () {
  if (this.phoneNumber) {
    const digitsOnly = String(this.phoneNumber).replace(/\D/g, "");
    this.phoneNumber = digitsOnly.slice(-10); // Standardize to last 10 digits
  }
});

// CRITICAL: Prevent duplicate phone numbers within the same user's personal address book
contactSchema.index({ user: 1, phoneNumber: 1 }, { unique: true });

// Optional: Speed up search by savedName
contactSchema.index({ user: 1, savedName: 1 });

// SAFE EXPORT: Prevents "OverwriteModelError" if imported across multiple files/controllers
module.exports =
  mongoose.models.Contact || mongoose.model("Contact", contactSchema);