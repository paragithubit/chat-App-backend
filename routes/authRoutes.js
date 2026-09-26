const express = require("express");
const router = express.Router();

const {
  sendOtp,
  verifyOtp,
  getGoogleAccounts,
  loginOrRegisterWithEmail,
  registerEmail,
  forgotPassword,
  resetPassword,
  getUserProfile,
  updateProfile,
  allUsers,
} = require("../controllers/authController");

const { protect } = require("../middleware/authMiddleware");

// 1. Mobile Number & OTP Verification Routes (Public)
router.post("/send-otp", sendOtp);
router.post("/verify-otp", verifyOtp);

// 2. Google OAuth & Email/Password Authentication Routes (Public)
router.get("/google-accounts", getGoogleAccounts);
router.post("/login-email", loginOrRegisterWithEmail);
router.post("/register-email", registerEmail);
router.post("/forgot-password", forgotPassword);
router.put("/reset-password/:resetToken", resetPassword);

// 3. User Profile Routes (Protected)
router
  .route("/profile")
  .get(protect, getUserProfile)
  .put(protect, updateProfile);

// 4. Search & List Users (Protected)
router.route("/users").get(protect, allUsers);

module.exports = router;