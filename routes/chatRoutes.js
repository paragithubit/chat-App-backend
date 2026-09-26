const express = require("express");
const router = express.Router();
const {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  toggleGroupAdmin,
  updateGroupPicture,
  clearChat,
  deleteChat,
  updateDisappearingMessages,
  toggleFavourite,
} = require("../controllers/chatController");
const { protect } = require("../middleware/authMiddleware");

// Base 1-on-1 and user chat routes
router.post("/", protect, accessChat);
router.get("/", protect, fetchChats);

// Group chat routes
router.post("/group", protect, createGroupChat);
router.put("/rename", protect, renameGroup);
router.put("/groupadd", protect, addToGroup);
router.put("/groupremove", protect, removeFromGroup);
router.put("/groupadmin", protect, toggleGroupAdmin);
router.put("/grouppicture", protect, updateGroupPicture);

// Disappearing messages route
router.put("/disappearing", protect, updateDisappearingMessages);

// Favourites route
router.put("/favourite/:chatId", protect, toggleFavourite);

// WhatsApp-style chat management routes
router.delete("/clear/:chatId", protect, clearChat);
router.delete("/:chatId", protect, deleteChat);

module.exports = router;