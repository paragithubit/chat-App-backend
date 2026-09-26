const express = require("express");
const { createStatus, getStatuses, viewStatus } = require("../controllers/statusController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.route("/").post(protect, createStatus).get(protect, getStatuses);
router.route("/:id/view").put(protect, viewStatus);

module.exports = router;