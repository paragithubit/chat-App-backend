const Status = require("../models/statusModel");
const Contact = require("../models/contactModel");
const User = require("../models/User");

// @desc    Create a new status (expires in 24 hours)
// @route   POST /api/status
// @access  Protected
const createStatus = async (req, res) => {
  try {
    const { content, mediaUrl, mediaType } = req.body;
    if (!content && !mediaUrl) {
      return res.status(400).json({ message: "Status content or media is required" });
    }

    const status = await Status.create({
      user: req.user._id,
      content,
      mediaUrl,
      mediaType: mediaType || "text",
    });

    const fullStatus = await Status.findById(status._id)
      .populate("user", "name profilePicture")
      .populate("viewedBy", "name profilePicture");
      
    res.status(201).json(fullStatus);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Get active statuses (not expired) from self and saved contacts only
// @route   GET /api/status
// @access  Protected
const getStatuses = async (req, res) => {
  try {
    const userId = req.user._id;

    // 1. Find all saved contacts owned by the current user
    const savedContacts = await Contact.find({ user: userId });

    // 2. Extract direct linked user IDs from the address book
    const linkedUserIds = savedContacts
      .map((c) => c.contactUser)
      .filter((id) => id != null);

    // 3. Extract phone numbers and create flexible regex patterns (matching last 10 digits to bypass +91 / spacing issues)
    const phoneRegexQueries = savedContacts
      .map((c) => {
        if (!c.phoneNumber) return null;
        const cleanDigits = c.phoneNumber.replace(/\D/g, ""); // strip non-digits
        if (cleanDigits.length >= 10) {
          const last10 = cleanDigits.slice(-10);
          return { phone: { $regex: last10 + "$" } };
        }
        return { phone: c.phoneNumber.trim() };
      })
      .filter((q) => q != null);

    // 4. Find user accounts matching either the direct IDs or the flexible phone patterns
    let phoneMatchedUserIds = [];
    if (phoneRegexQueries.length > 0) {
      const matchedUsers = await User.find({ $or: phoneRegexQueries }).select("_id");
      phoneMatchedUserIds = matchedUsers.map((u) => u._id);
    }

    // 5. Combine current user's ID + linked contacts + phone-matched users and remove duplicates
    const allowedUserIds = [
      userId,
      ...linkedUserIds,
      ...phoneMatchedUserIds,
    ].map((id) => id.toString());

    const uniqueAllowedUserIds = [...new Set(allowedUserIds)];

    // 6. Query active unexpired statuses matching the allowed unique user list
    const statuses = await Status.find({
      user: { $in: uniqueAllowedUserIds },
      expiresAt: { $gt: Date.now() },
    })
      .populate("user", "name profilePicture")
      .populate("viewedBy", "name profilePicture")
      .sort({ createdAt: -1 });

    res.json(statuses);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    Mark a status as viewed by the current user
// @route   PUT /api/status/:id/view
// @access  Protected
const viewStatus = async (req, res) => {
  try {
    const status = await Status.findById(req.params.id);
    if (!status) {
      return res.status(404).json({ message: "Status not found" });
    }

    const currentUserIdStr = req.user._id.toString();
    const isOwner = status.user.toString() === currentUserIdStr;
    const hasAlreadyViewed = status.viewedBy.some(
      (viewerId) => viewerId.toString() === currentUserIdStr
    );

    // Only add viewer if they are not the owner and haven't viewed it yet
    if (!isOwner && !hasAlreadyViewed) {
      status.viewedBy.push(req.user._id);
      await status.save();
    }

    const updatedStatus = await Status.findById(status._id)
      .populate("user", "name profilePicture")
      .populate("viewedBy", "name profilePicture");

    res.status(200).json(updatedStatus);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createStatus, getStatuses, viewStatus };