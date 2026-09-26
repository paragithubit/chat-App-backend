const express = require("express");
const https = require("https");
const http = require("http");
const {
  sendMessage,
  allMessages,
  markAsRead,
  editMessage,
  deleteMessage,
  deleteMultipleMessages,
  clearChat,
  reactToMessage,
  votePoll,
} = require("../controllers/messageController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// 1. BASE MESSAGE ROUTE
router.route("/").post(protect, sendMessage);

// 2. FILE DOWNLOAD PROXY ROUTE
router.get("/download", (req, res) => {
  const { url, filename } = req.query;

  if (!url) {
    return res.status(400).json({ message: "File URL is required" });
  }

  const client = url.startsWith("https") ? https : http;

  client
    .get(url, (fileStream) => {
      if (fileStream.statusCode >= 400) {
        return res
          .status(fileStream.statusCode)
          .json({ message: "Failed to fetch file from storage provider" });
      }

      const safeFilename = encodeURIComponent(filename || "document.pdf");

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeFilename}"`
      );
      res.setHeader(
        "Content-Type",
        fileStream.headers["content-type"] || "application/octet-stream"
      );

      fileStream.pipe(res);
    })
    .on("error", (err) => {
      console.error("File download proxy error:", err);
      res.status(500).json({ message: "Error downloading file" });
    });
});

// 3. MESSAGE ACTIONS & RETRIEVAL (Specific routes placed before dynamic :id parameters)
router.route("/read/:chatId").put(protect, markAsRead);
router.route("/clear/:chatId").put(protect, clearChat);
router.route("/edit/:id").put(protect, editMessage);
router.route("/bulk-delete").delete(protect, deleteMultipleMessages);
router.route("/react/:id").put(protect, reactToMessage);
router.route("/vote").put(protect, votePoll);

// Dynamic parameter routes placed last to prevent routing collisions
router.route("/delete/:id").delete(protect, deleteMessage);
router.route("/:id").delete(protect, deleteMessage);
router.route("/:chatId").get(protect, allMessages);

module.exports = router;