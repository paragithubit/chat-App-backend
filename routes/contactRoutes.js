const express = require("express");
const {
  getContacts,
  checkContactByPhone,
  addContact,
  deleteContact,
} = require("../controllers/contactController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// 1. Phone number pre-check route
// GET /api/contacts/check?phone=xxxxxxxxxx
router.get("/check", protect, checkContactByPhone);

// 2. Direct endpoint used by AddContactModal
// POST /api/contacts/add
router.post("/add", protect, addContact);

// 3. Base collection routes
// GET  /api/contacts -> Get all contacts
// POST /api/contacts -> Add contact (standard REST)
router
  .route("/")
  .get(protect, getContacts)
  .post(protect, addContact);

// 4. Single contact operations by MongoDB _id
// DELETE /api/contacts/:contactId
router.delete("/:contactId", protect, deleteContact);

module.exports = router;