const twilio = require("twilio");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Otp = require("../models/OtpModel");

// Helper: Generate JWT Token
const generateToken = (id) => {
  if (process.env.JWT_SECRET) {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "30d" });
  }
  return "token_" + id;
};

// Helper: Format to international standard (+91 for India)
const formatPhoneNumber = (num) => {
  if (!num) return null;
  const digits = num.toString().replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  return `+91${last10}`;
};

// 1. Send OTP via Twilio Verify (With Automatic Dev Fallback)
const sendOtp = async (req, res) => {
  const rawPhone = req.body.phoneNumber || req.body.phone;
  const formattedPhone = formatPhoneNumber(rawPhone);

  if (!formattedPhone) {
    return res.status(400).json({
      success: false,
      message: "Please enter a valid 10-digit mobile number.",
    });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();

  // Try real Twilio Verify SMS first
  if (accountSid && authToken && serviceSid) {
    try {
      const client = twilio(accountSid, authToken);
      const verification = await client.verify.v2
        .services(serviceSid)
        .verifications.create({
          to: formattedPhone,
          channel: "sms",
        });

      console.log(`✅ Twilio SMS sent! Status: ${verification.status} for ${formattedPhone}`);
      return res.status(200).json({
        success: true,
        message: "Real OTP sent to your phone via SMS!",
      });
    } catch (twilioError) {
      console.warn(`⚠️ Twilio Verify notice: ${twilioError.message}`);
      console.warn("🔄 Activating Dev Fallback so unverified tester numbers can still log in...");
    }
  }

  // --- DEV FALLBACK (Runs if Twilio fails or number is an unverified tester) ---
  try {
    const fallbackOtp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store in MongoDB so verifyOtp can match it
    await Otp.deleteMany({ phoneNumber: formattedPhone });
    await Otp.create({
      phoneNumber: formattedPhone,
      otpCode: fallbackOtp,
    });

    console.log(`\n======================================================`);
    console.log(`📱 [DEV OTP FOR]: ${formattedPhone}`);
    console.log(`🔑 ENTER CODE ON SCREEN: 👉 ${fallbackOtp} 👈`);
    console.log(`======================================================\n`);

    return res.status(200).json({
      success: true,
      message: `Trial/Dev OTP: ${fallbackOtp}`,
      devOtp: fallbackOtp,
    });
  } catch (dbErr) {
    console.error("Database error saving fallback OTP:", dbErr);
    return res.status(500).json({
      success: false,
      message: "Failed to generate verification OTP.",
    });
  }
};

// 2. Check/Verify OTP & Sync with MongoDB User
const verifyOtp = async (req, res) => {
  try {
    const rawPhone = req.body.phoneNumber || req.body.phone;
    const rawOtp = req.body.enteredOtp || req.body.otp;
    const customName = req.body.name?.trim();

    const formattedPhone = formatPhoneNumber(rawPhone);
    const clean10DigitPhone = formattedPhone ? formattedPhone.slice(-10) : null;
    const enteredOtp = rawOtp ? rawOtp.toString().trim() : null;

    if (!formattedPhone || !enteredOtp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP code are required.",
      });
    }

    let isApproved = false;

    // Check Twilio Verify first
    const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
    const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();

    if (accountSid && authToken && serviceSid) {
      try {
        const client = twilio(accountSid, authToken);
        const verificationCheck = await client.verify.v2
          .services(serviceSid)
          .verificationChecks.create({
            to: formattedPhone,
            code: enteredOtp,
          });

        if (verificationCheck.status === "approved") {
          isApproved = true;
        }
      } catch (err) {
        // Continue to check database fallback if Twilio check fails
      }
    }

    // Check MongoDB fallback record if not approved by Twilio
    if (!isApproved) {
      const record = await Otp.findOne({
        phoneNumber: formattedPhone,
        otpCode: enteredOtp,
      });

      if (record) {
        isApproved = true;
        await Otp.deleteMany({ phoneNumber: formattedPhone });
      }
    }

    if (!isApproved) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired OTP code.",
      });
    }

    // OTP Approved! Look up existing user in MongoDB
    let user = await User.findOne({
      $or: [
        { phone: clean10DigitPhone },
        { phone: formattedPhone },
      ],
    });

    if (user) {
      // EXISTING USER: Return their existing database record and token
      const token = generateToken(user._id);

      return res.status(200).json({
        success: true,
        isNewUser: false,
        message: "Welcome back!",
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profilePicture: user.profilePicture || "",
          bio: user.bio || "",
          token: token,
        },
      });
    } else {
      // NEW USER: Register fresh account in MongoDB
      const newUser = await User.create({
        name: customName || `User_${clean10DigitPhone.slice(-4)}`,
        phone: clean10DigitPhone,
        email: `${clean10DigitPhone}@phoneauth.com`,
        password: Math.random().toString(36).slice(-10),
      });

      const token = generateToken(newUser._id);

      return res.status(201).json({
        success: true,
        isNewUser: true,
        message: "Account created successfully!",
        user: {
          _id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          profilePicture: newUser.profilePicture || "",
          bio: newUser.bio || "",
          token: token,
        },
      });
    }
  } catch (error) {
    console.error("OTP verification error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error during verification.",
    });
  }
};

module.exports = { sendOtp, verifyOtp };