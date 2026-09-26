const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { accessAIChat, handleIsolatedAIChat } = require("../controllers/aiController");

const router = express.Router();

// Route to get or initialize the isolated Meta AI chat room for the sidebar/pinned list
router.route("/room").get(protect, accessAIChat);

// Route for standalone, isolated AI chat / Meta AI assistant & image generation
router.route("/chat").post(protect, handleIsolatedAIChat);

module.exports = router;