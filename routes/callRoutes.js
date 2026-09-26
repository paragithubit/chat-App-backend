const express = require("express");
const { 
  getCallOptions,   // Matches the exported function name in callController.js
  logCall, 
  deleteCallLog, 
  clearAllCallLogs 
} = require("../controllers/callController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// Route to fetch all call logs and log a new call
router.route("/").get(protect, getCallOptions).post(protect, logCall);

// Route to clear all call history for the user (MUST be placed before /:callId)
router.route("/clear").delete(protect, clearAllCallLogs);

// Route to delete an individual call log by its ID
router.route("/:callId").delete(protect, deleteCallLog);

module.exports = router;