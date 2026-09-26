const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const {
  allUsers,
  getUserDirectory,
  updateProfilePicture,
  updatePublicKey,
  blockUser,
  unblockUser,
  deleteUserAccount,
} = require("../controllers/userController");

const router = express.Router();

// GET /api/users/directory - Must be placed BEFORE /:id or / routes to prevent path conflict
router.route("/directory").get(protect, getUserDirectory);

// GET /api/users?search=query
router.route("/").get(protect, allUsers);

// PUT /api/users/profile-pic
router.route("/profile-pic").put(protect, updateProfilePicture);

// PUT /api/users/update-public-key
router.route("/update-public-key").put(protect, updatePublicKey);

// PUT /api/users/block
router.route("/block").put(protect, blockUser);

// PUT /api/users/unblock
router.route("/unblock").put(protect, unblockUser);

// DELETE /api/users/delete
router.route("/delete").delete(protect, deleteUserAccount);

module.exports = router;