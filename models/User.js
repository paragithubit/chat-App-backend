const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Safe, zero-network fallback avatar (Clean SVG Data URI)
const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 128 128' fill='%2394a3b8'><circle cx='64' cy='44' r='28'/><path d='M16 112c0-26.5 21.5-48 48-48s48 21.5 48 48H16z'/></svg>";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: "New User",
    },
    phone: {
      type: String,
      required: false,
      unique: true,
      sparse: true,
      trim: true,
      match: [/^[0-9]{10}$/, "Please enter a valid 10-digit phone number"],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      unique: true,
      sparse: true,
    },
    password: {
      type: String,
      select: false,
      trim: true,
    },
    publicKey: {
      type: String,
      default: "",
    },
    resetPasswordToken: {
      type: String,
    },
    resetPasswordExpire: {
      type: Date,
    },
    firebaseUid: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    profilePicture: {
      type: String,
      default: DEFAULT_AVATAR,
    },
    bio: {
      type: String,
      default: "Hey there! I am using MERN Chat.",
      trim: true,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

// Pre-validate hook: ensure phone numbers are cleanly trimmed to 10 digits before schema validation runs
userSchema.pre("validate", function () {
  if (this.phone) {
    const cleanDigits = this.phone.replace(/\D/g, "");
    this.phone = cleanDigits.slice(-10);
  }
});

// Hash password automatically before saving to database if modified
userSchema.pre("save", async function () {
  if (!this.isModified("password") || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to verify passwords during login
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model("User", userSchema);
module.exports = User;