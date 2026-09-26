const User = require("../models/User");
const Contact = require("../models/contactModel");

// Helper function to validate exact 10-digit phone numbers
const isValid10DigitPhone = (phone) => {
  if (!phone) return false;
  const cleanDigits = phone.toString().replace(/\D/g, "");
  return cleanDigits.length === 10;
};

// Search users ONLY within the current user's saved contact book (WhatsApp-style privacy)
const allUsers = async (req, res) => {
  const searchQuery = req.query.search || "";

  try {
    // 1. Fetch only the contacts saved by the logged-in user using the 'user' field
    const userContacts = await Contact.find({ user: req.user._id }).populate({
      path: "contactUser",
      select: "-password",
    });

    // 2. Filter local saved contacts matching the search query (name, email, or phone)
    const matchingContacts = userContacts.filter((c) => {
      const contactUser = c.contactUser;
      if (!contactUser) return false;

      const nameMatch =
        c.savedName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        contactUser.name.toLowerCase().includes(searchQuery.toLowerCase());
      const emailMatch = contactUser.email?.toLowerCase().includes(searchQuery.toLowerCase());
      const phoneMatch = c.phoneNumber?.includes(searchQuery) || contactUser.phone?.includes(searchQuery);

      return nameMatch || emailMatch || phoneMatch;
    });

    // 3. Format results to display the custom phonebook name
    const formattedResults = matchingContacts.map((c) => {
      const u = c.contactUser.toObject();
      return {
        ...u,
        name: c.savedName, // Override with saved contact name
        isSavedContact: true,
      };
    });

    return res.status(200).json(formattedResults);
  } catch (error) {
    console.error("Error in restricted contact search:", error);
    return res.status(500).json({ message: "Failed to search contacts" });
  }
};

// Get user directory restricted ONLY to saved contacts (WhatsApp-style)
const getUserDirectory = async (req, res) => {
  try {
    // Fetch only the contacts belonging to the authenticated user using the 'user' field
    const userContacts = await Contact.find({ user: req.user._id }).populate({
      path: "contactUser",
      select: "-password",
    });

    const directory = userContacts
      .filter((c) => c.contactUser) // Ensure valid reference exists
      .map((c) => {
        const u = c.contactUser;
        return {
          _id: u._id,
          savedName: c.savedName,
          phoneNumber: c.phoneNumber || u.phone,
          isSavedContact: true,
          contactUser: {
            _id: u._id,
            name: u.name,
            phone: u.phone,
            profilePicture: u.profilePicture,
            email: u.email,
            bio: u.bio,
          },
        };
      });

    return res.status(200).json(directory);
  } catch (error) {
    console.error("Error fetching restricted user directory:", error);
    return res.status(500).json({ message: "Failed to fetch user directory" });
  }
};

// Update profile picture
const updateProfilePicture = async (req, res) => {
  try {
    const { profilePicture } = req.body;
    const userId = req.user?._id;

    if (!profilePicture) {
      return res.status(400).json({ message: "Profile picture data is required" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePicture },
      { returnDocument: 'after' }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating profile picture:", error);
    return res.status(500).json({ message: "Server error updating profile picture" });
  }
};

// Update user public key for End-to-End Encryption (E2EE)
const updatePublicKey = async (req, res) => {
  try {
    const { publicKey } = req.body;
    const userId = req.user?._id;

    if (!publicKey) {
      return res.status(400).json({ message: "Public key is required" });
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { publicKey },
      { returnDocument: 'after' }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.status(200).json(updatedUser);
  } catch (error) {
    console.error("Error updating public key:", error);
    return res.status(500).json({ message: "Server error updating public key" });
  }
};

// Block a user
const blockUser = async (req, res) => {
  try {
    const { userIdToBlock } = req.body;

    if (!userIdToBlock) {
      return res.status(400).json({ message: "User ID to block is required" });
    }

    if (req.user._id.toString() === userIdToBlock) {
      return res.status(400).json({ message: "You cannot block yourself" });
    }

    const currentUser = await User.findById(req.user._id);
    
    const isAlreadyBlocked = currentUser.blockedUsers.some(
      (id) => id.toString() === userIdToBlock
    );

    if (!isAlreadyBlocked) {
      currentUser.blockedUsers.push(userIdToBlock);
      await currentUser.save();
    }

    return res.status(200).json({ message: "User blocked successfully" });
  } catch (error) {
    console.error("Error blocking user:", error);
    return res.status(500).json({ message: error.message || "Failed to block user" });
  }
};

// Unblock a user
const unblockUser = async (req, res) => {
  try {
    const { userIdToUnblock } = req.body;

    if (!userIdToUnblock) {
      return res.status(400).json({ message: "User ID to unblock is required" });
    }

    const currentUser = await User.findById(req.user._id);
    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (id) => id.toString() !== userIdToUnblock
    );
    await currentUser.save();

    return res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.error("Error unblocking user:", error);
    return res.status(500).json({ message: error.message || "Failed to unblock user" });
  }
};

// Delete user account
const deleteUserAccount = async (req, res) => {
  try {
    const userId = req.user._id;

    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Clean up related contact data using the 'user' field
    await Contact.deleteMany({ user: userId });
    await Contact.deleteMany({ contactUser: userId });

    return res.status(200).json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Error deleting user account:", error);
    return res.status(500).json({ message: "Server error deleting account" });
  }
};

module.exports = {
  allUsers,
  getUserDirectory,
  updateProfilePicture,
  updatePublicKey,
  blockUser,
  unblockUser,
  deleteUserAccount,
};