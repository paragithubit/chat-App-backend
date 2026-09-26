const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const axios = require("axios");
const User = require("../models/User");
const OTP = require("../models/OtpModel");
const generateToken = require("../config/generateToken");
const sendEmail = require("../utils/sendEmail");

// Helper function to validate password complexity
const validatePassword = (password) => {
  // 1. Must start with a capital letter [A-Z]
  // 2. Must contain at least one number (?=.*\d)
  // 3. Must contain at least one special character (?=.*[!@#$%^&*(),.?":{}|<>-])
  // 4. Minimum length of 6 characters
  const passwordRegex = /^[A-Z](?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>-]).{5,}$/;
  return passwordRegex.test(password);
};

// 1. SEND OTP via Terminal Log (Bypassing external gateway errors)
const sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const cleanPhone = phone.toString().replace(/\D/g, "").slice(-10);

    if (cleanPhone.length !== 10) {
      return res
        .status(400)
        .json({ message: "Please enter a valid 10-digit mobile number" });
    }

    const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

    await OTP.deleteMany({ phone: cleanPhone });
    await OTP.create({ phone: cleanPhone, otp: generatedOtp });

    console.log(`\n========================================`);
    console.log(`📱 WhatsApp OTP for ${cleanPhone}: [ ${generatedOtp} ]`);
    console.log(`========================================\n`);

    res.status(200).json({
      message: "OTP sent successfully to terminal",
      phone: cleanPhone,
      devOtp: generatedOtp,
    });
  } catch (error) {
    console.error("Error in sendOtp:", error);
    res.status(500).json({ message: error.message || "Failed to send OTP" });
  }
};

// 2. VERIFY OTP & SIGN IN / SIGN UP
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp, name, firebaseUid } = req.body;

    if (!phone) {
      return res.status(400).json({ message: "Phone number is required" });
    }

    const cleanPhone = phone.toString().replace(/\D/g, "").slice(-10);

    if (cleanPhone.length !== 10) {
      return res.status(400).json({
        message: "Invalid phone number format. Exactly 10 digits required.",
      });
    }

    if (!firebaseUid && otp) {
      const cleanOtp = otp.toString().trim();
      const otpRecord = await OTP.findOne({ phone: cleanPhone, otp: cleanOtp });
      if (!otpRecord) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }
      await OTP.deleteMany({ phone: cleanPhone });
    }

    let user = await User.findOne({ phone: cleanPhone });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;

      const newUserData = {
        phone: cleanPhone,
        name:
          name && name.trim().length > 0
            ? name.trim()
            : `User_${cleanPhone.slice(-4)}`,
      };

      if (firebaseUid) {
        newUserData.firebaseUid = firebaseUid;
      }

      user = await User.create(newUserData);
    } else {
      let shouldSave = false;

      if (name && name.trim() && (!user.name || user.name.startsWith("User_"))) {
        user.name = name.trim();
        shouldSave = true;
      }

      if (firebaseUid && !user.firebaseUid) {
        user.firebaseUid = firebaseUid;
        shouldSave = true;
      }

      if (shouldSave) {
        await user.save();
      }
    }

    const token = generateToken(user._id);

    res.status(200).json({
      message: "Authentication successful",
      isNewUser,
      _id: user._id,
      id: user._id,
      name: user.name,
      phone: user.phone,
      profilePicture: user.profilePicture,
      bio: user.bio,
      lastSeen: user.lastSeen,
      token,
    });
  } catch (error) {
    console.error("Detailed Error in verifyOtp:", error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({
        message: `An account with this ${field} already exists.`,
      });
    }

    res.status(500).json({
      message: error.message || "Authentication failed",
    });
  }
};

// 3. GET REGISTERED GOOGLE ACCOUNTS (Account Picker Popup Sync)
const getGoogleAccounts = async (req, res) => {
  try {
    const users = await User.find({ email: { $exists: true, $ne: null } }).select("name email profilePicture");
    res.status(200).json(users);
  } catch (error) {
    console.error("Error in getGoogleAccounts:", error);
    res.status(500).json({ message: "Failed to fetch accounts" });
  }
};

// 4. LOGIN WITH EMAIL & PASSWORD
const loginOrRegisterWithEmail = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide both email and password" });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: cleanEmail }).select("+password");

    if (!user) {
      return res.status(404).json({ message: "No account found with this email address. Please register first." });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Incorrect password. Please try again." });
    }

    const token = generateToken(user._id);

    return res.status(200).json({
      message: "Email authentication successful",
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
      bio: user.bio,
      lastSeen: user.lastSeen,
      token,
    });
  } catch (error) {
    console.error("Error in loginOrRegisterWithEmail:", error);
    return res.status(500).json({ message: error.message || "Server error during authentication" });
  }
};

// 5. REGISTER NEW EMAIL ACCOUNT (Strictly requires 10-digit phone & complex password)
const registerEmail = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide both email and password" });
    }

    // ── STRICT 10-DIGIT PHONE VALIDATION GUARD ──
    if (!phone) {
      return res.status(400).json({ message: "Mobile number is required for registration." });
    }

    const cleanPhone = phone.toString().replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ 
        message: "Mobile number must be exactly 10 digits. Registration failed." 
      });
    }

    // ── STRICT PASSWORD VALIDATION CHECK ──
    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must start with a capital letter, contain at least one number, one special character, and be at least 6 characters long (e.g., User@000)."
      });
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: cleanEmail });

    if (existingUser) {
      return res.status(400).json({ message: "An account with this email already exists. Please sign in instead." });
    }

    const newUserData = {
      name: name && name.trim() ? name.trim() : cleanEmail.split("@")[0],
      email: cleanEmail,
      password: password,
      phone: cleanPhone, // Stored safely and guaranteed to be 10 digits
    };

    const user = await User.create(newUserData);
    const token = generateToken(user._id);

    return res.status(201).json({
      message: "Account registered successfully",
      _id: user._id,
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
      bio: user.bio,
      lastSeen: user.lastSeen,
      token,
    });
  } catch (error) {
    console.error("Error in registerEmail:", error);

    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      return res.status(400).json({
        message: `An account with this ${field} already exists.`,
      });
    }

    return res.status(500).json({ message: error.message || "Server error during registration" });
  }
};

// 6. FORGOT PASSWORD (Sends clickable token link to user's registered email)
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Please provide an email address" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ message: "No account found with this email address." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 mins expiry
    await user.save();

    const resetUrl = `http://localhost:5173/#/reset-password/${resetToken}`;

    const message = `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Password Reset Request</h2>
        <p>You requested a password reset for your account. Please click the link below to set a new password:</p>
        <a href="${resetUrl}" target="_blank" style="background-color: #0d9488; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; margin-bottom: 10px;">Reset Password</a>
        <p>Or copy and paste this link into your browser:</p>
        <p><a href="${resetUrl}" target="_blank">${resetUrl}</a></p>
        <p style="color: #666; font-size: 12px; margin-top: 20px;">This link will expire in 15 minutes. If you did not request this, please ignore this email.</p>
      </div>
    `;

    await sendEmail({
      email: user.email,
      subject: "Password Reset Request",
      html: message,
    });

    res.status(200).json({ message: "Password reset link sent successfully to your email." });
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    res.status(500).json({ message: "Error sending password reset email. Please try again later." });
  }
};

// 7. RESET PASSWORD (Updates password in DB using token link)
const resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    
    // ── STRICT PASSWORD VALIDATION CHECK ──
    if (!password || !validatePassword(password)) {
      return res.status(400).json({ 
        message: "Password must start with a capital letter, contain at least one number, one special character, and be at least 6 characters long (e.g., User@000)." 
      });
    }

    const resetPasswordToken = crypto.createHash("sha256").update(req.params.resetToken).digest("hex");

    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired password reset token." });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ message: "Password updated successfully. You can now sign in." });
  } catch (error) {
    console.error("Error in resetPassword:", error);
    res.status(500).json({ message: "Failed to reset password" });
  }
};

// 8. GET USER PROFILE (PROTECTED)
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.status(200).json(user);
  } catch (error) {
    console.error("Error in getUserProfile:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// 9. UPDATE USER PROFILE (Photo, Bio, Name)
const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (req.body.name) {
      user.name = req.body.name.trim();
    }
    if (req.body.bio !== undefined) {
      user.bio = req.body.bio.trim();
    }
    if (req.body.profilePicture) {
      user.profilePicture = req.body.profilePicture;
    }

    const updatedUser = await user.save();

    res.status(200).json({
      _id: updatedUser._id,
      id: updatedUser._id,
      name: updatedUser.name,
      phone: updatedUser.phone,
      profilePicture: updatedUser.profilePicture,
      bio: updatedUser.bio,
      lastSeen: updatedUser.lastSeen,
    });
  } catch (error) {
    console.error("Error in updateProfile:", error);
    res.status(500).json({ message: error.message || "Server error" });
  }
};

// 10. SEARCH USERS BY NAME OR 10-DIGIT PHONE NUMBER
const allUsers = async (req, res) => {
  try {
    const keyword = req.query.search
      ? {
        $or: [
          { name: { $regex: req.query.search, $options: "i" } },
          { phone: { $regex: req.query.search, $options: "i" } },
        ],
      }
      : {};

    const users = await User.find(keyword).find({ _id: { $ne: req.user._id } });

    res.status(200).json(users);
  } catch (error) {
    console.error("Error in allUsers:", error);
    res.status(500).json({ message: "Server error" });
  }
};

module.exports = {
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
};