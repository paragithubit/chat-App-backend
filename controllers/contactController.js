const Contact = require("../models/contactModel"); // Match exact PascalCase filename
const User = require("../models/User");

// Helper: Escape regex special characters to prevent search crash
const escapeRegex = (text) => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

// 1. Get all saved contacts for the logged-in user (Guaranteed No Duplicates)
const getContacts = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    const userId = req.user._id;
    const searchQuery = req.query.search;

    let query = { user: userId };

    if (searchQuery && searchQuery.trim() !== "") {
      const keyword = escapeRegex(searchQuery.trim());

      const matchingUsers = await User.find({
        name: { $regex: keyword,$options: "i" },
      }).select("_id");

      const matchingUserIds = matchingUsers.map((u) => u._id);

      query = {
        user: userId,
        $or: [
          { savedName: { $regex: keyword,$options: "i" } },
          { phoneNumber: { $regex: keyword,$options: "i" } },
          { contactUser: { $in: matchingUserIds } },
        ],
      };
    }

    const contacts = await Contact.find(query)
      .populate("contactUser", "name phone profilePicture email")
      .sort({ createdAt: 1 });

    // In-memory deduplication by 10-digit number
    const seenPhones = new Set();
    const uniqueContacts = [];

    for (const c of contacts) {
      const digits = String(c.phoneNumber || "").replace(/\D/g, "").slice(-10);
      if (digits && !seenPhones.has(digits)) {
        seenPhones.add(digits);
        uniqueContacts.push(c);
      } else if (!digits) {
        uniqueContacts.push(c);
      }
    }

    // Sort alphabetically by savedName
    uniqueContacts.sort((a, b) =>
      String(a.savedName || "").localeCompare(String(b.savedName || ""))
    );

    return res.status(200).json(uniqueContacts);
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return res.status(500).json({ message: "Failed to fetch contacts", error: error.message });
  }
};

// 2. Check if a specific phone number is already saved
const checkContactByPhone = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    const { phone } = req.query;
    if (!phone) {
      return res.status(400).json({ message: "Phone number is required for checking" });
    }

    const last10 = String(phone).trim().replace(/\D/g, "").slice(-10);

    const existingContact = await Contact.findOne({
      user: req.user._id,
      phoneNumber: last10,
    });

    return res.status(200).json({
      exists: !!existingContact,
      savedName: existingContact ? existingContact.savedName : null,
    });
  } catch (error) {
    console.error("Error checking contact:", error);
    return res.status(500).json({ message: "Failed to check contact", error: error.message });
  }
};

// 3. Save a new contact safely (Prevents 500 error & duplicate numbers)
const addContact = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Not authorized, token missing or invalid." });
    }

    const body = req.body || {};
    const phoneNumber = body.phoneNumber;
    const savedName = body.savedName;
    const contactUserId = body.contactUserId;

    if (!phoneNumber || !savedName) {
      return res.status(400).json({ message: "Phone number and saved name are required." });
    }

    // Clean phone number to strictly 10 digits
    const cleanPhone = String(phoneNumber).trim().replace(/\D/g, "");
    const digitOnlyPhone = cleanPhone.slice(-10);

    if (digitOnlyPhone.length !== 10) {
      return res.status(400).json({
        message: "This is not a valid phone number. It must be exactly 10 digits.",
      });
    }

    const currentUserId = req.user._id;

    // A. Check if the user already saved this phone number before
    const existingContact = await Contact.findOne({
      user: currentUserId,
      phoneNumber: digitOnlyPhone,
    }).populate("contactUser", "name phone profilePicture email");

    if (existingContact) {
      return res.status(409).json({
        success: false,
        message: `This phone number is already saved as "${existingContact.savedName}". Duplicate contact prevented.`,
        contact: existingContact,
      });
    }

    // B. Link to platform user account if registered
    let targetUserId = null;
    if (contactUserId && String(contactUserId).trim().length === 24) {
      targetUserId = contactUserId;
    } else {
      const targetUser = await User.findOne({
        $or: [
          { phone: digitOnlyPhone },
          { phone: `+91${digitOnlyPhone}` },
          { phone: { $regex: `${digitOnlyPhone}$` } },
        ],
      }).select("_id");

      if (targetUser) {
        targetUserId = targetUser._id;
      }
    }

    // Prevent user from adding their own phone number as a contact
    if (targetUserId && String(targetUserId) === String(currentUserId)) {
      return res.status(400).json({ message: "You cannot add your own number as a contact." });
    }

    // C. Create contact safely without null-field cast issues
    const contactData = {
      user: currentUserId,
      savedName: String(savedName).trim(),
      phoneNumber: digitOnlyPhone,
    };

    if (targetUserId) {
      contactData.contactUser = targetUserId;
    }

    const newContact = await Contact.create(contactData);

    const populatedContact = await Contact.findById(newContact._id).populate(
      "contactUser",
      "name phone profilePicture email"
    );

    return res.status(201).json(populatedContact || newContact);
  } catch (error) {
    console.error("--- DETAILED ADD CONTACT ERROR ---");
    console.error(error);
    console.error("----------------------------------");

    // Catch MongoDB duplicate compound index error (E11000)
    if (error.code === 11000) {
      const safePhone = String(req.body?.phoneNumber || "").replace(/\D/g, "").slice(-10);
      const existing = await Contact.findOne({
        user: req.user?._id,
        phoneNumber: safePhone,
      });

      return res.status(409).json({
        success: false,
        message: `This phone number is already saved as "${existing?.savedName || "existing contact"}".`,
        contact: existing,
      });
    }

    return res.status(500).json({
      message: error.message || "Failed to save contact.",
    });
  }
};

// 4. Delete a saved contact
const deleteContact = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: "Not authorized, user not found" });
    }

    const { contactId } = req.params;

    const contact = await Contact.findById(contactId);
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    if (contact.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    await Contact.findByIdAndDelete(contactId);
    return res.status(200).json({ message: "Contact deleted successfully", contactId });
  } catch (error) {
    console.error("Error deleting contact:", error);
    return res.status(500).json({ message: "Failed to delete contact", error: error.message });
  }
};

module.exports = {
  getContacts,
  checkContactByPhone,
  addContact,
  deleteContact,
};