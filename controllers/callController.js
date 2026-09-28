const Call = require("../models/callModel");
const Chat = require("../models/Chat");

// Get all call logs for logged-in user (1-on-1 + Group Calls)
const getCallOptions = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all chats where the logged-in user is a participant (to fetch group calls)
    const userChats = await Chat.find({ users: userId }).select("_id");
    const chatIds = userChats.map((chat) => chat._id);

    // Fetch calls where user is caller, receiver, or participant of the group chat
    const calls = await Call.find({
      $or: [
        { caller: userId },
        { receiver: userId },
        { chatId: { $in: chatIds } },
      ],
      deletedFor: { $ne: userId },
    })
      .populate({
        path: "caller",
        select: "name email profilePicture phone",
        strictPopulate: false,
      })
      .populate({
        path: "receiver",
        select: "name email profilePicture phone",
        strictPopulate: false,
      })
      .populate({
        path: "chatId",
        select: "chatName groupImage isGroupChat users",
        populate: {
          path: "users",
          select: "name email profilePicture phone",
        },
        strictPopulate: false,
      })
      .sort({ createdAt: -1 });

    res.json(calls);
  } catch (error) {
    console.error("🔥 Error in getCallOptions:", error.message);
    res.status(400).json({ message: error.message });
  }
};

// Log a new call (Supports 1-on-1 and Group Calls with automatic group detection)
const logCall = async (req, res) => {
  const { receiverId, chatId, isGroupCall, callType, callStatus } = req.body;

  try {
    const userId = req.user._id;

    // Normalize call status to avoid schema validation errors (supports "missed", "completed", "rejected")
    const resolvedStatus = callStatus || "completed";

    // Check if a chatId is provided
    if (chatId) {
      // Verify whether this chat is actually a group chat
      const chat = await Chat.findById(chatId);
      const isActuallyGroup = chat && (chat.isGroupChat || (chat.users && chat.users.length > 2));

      if (isGroupCall || isActuallyGroup) {
        const newCall = await Call.create({
          caller: userId,
          receiver: null,
          chatId: chatId,
          isGroupCall: true,
          callType: callType || "video",
          callStatus: resolvedStatus,
        });

        const fullCall = await Call.findById(newCall._id)
          .populate({
            path: "caller",
            select: "name email profilePicture phone",
            strictPopulate: false,
          })
          .populate({
            path: "chatId",
            select: "chatName groupImage isGroupChat users",
            populate: {
              path: "users",
              select: "name email profilePicture phone",
            },
            strictPopulate: false,
          });

        return res.status(201).json(fullCall);
      }
    }

    // 2. 1-on-1 Call Logging (Incoming, Outgoing, or Missed)
    if (receiverId) {
      const newCall = await Call.create({
        caller: userId,
        receiver: receiverId,
        chatId: chatId || null,
        isGroupCall: false,
        callType: callType || "video",
        callStatus: resolvedStatus,
      });

      const fullCall = await Call.findById(newCall._id)
        .populate({
          path: "caller",
          select: "name email profilePicture phone",
          strictPopulate: false,
        })
        .populate({
          path: "receiver",
          select: "name email profilePicture phone",
          strictPopulate: false,
        })
        .populate({
          path: "chatId",
          select: "chatName groupImage isGroupChat users",
          strictPopulate: false,
        });

      return res.status(201).json(fullCall);
    }

    res.status(400).json({ message: "Invalid call logging parameters" });
  } catch (error) {
    console.error("🔥 Error in logCall:", error.message);
    res.status(400).json({ message: error.message });
  }
};

// Delete call log strictly for the requesting user
const deleteCallLog = async (req, res) => {
  try {
    const { callId } = req.params;
    const userId = req.user._id;

    const call = await Call.findById(callId);
    if (!call) {
      return res.status(404).json({ message: "Call log not found" });
    }

    // Ensure deletedFor array exists and add user safely
    call.deletedFor = call.deletedFor || [];
    if (!call.deletedFor.includes(userId)) {
      call.deletedFor.push(userId);
      await call.save();
    }

    res.json({ message: "Call log deleted successfully for you" });
  } catch (error) {
    console.error("🔥 Error in deleteCallLog:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// Clear / remove all call history for the requesting user
const clearAllCallLogs = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all chats where the user is a participant
    const userChats = await Chat.find({ users: userId }).select("_id");
    const chatIds = userChats.map((chat) => chat._id);

    // Update all relevant call logs by adding the user to their deletedFor array
    await Call.updateMany(
      {
        $or: [
          { caller: userId },
          { receiver: userId },
          { chatId: { $in: chatIds } },
        ],
        deletedFor: { $ne: userId },
      },
      {
        $addToSet: { deletedFor: userId },
      }
    );

    res.json({ message: "All call history cleared successfully for you" });
  } catch (error) {
    console.error("🔥 Error in clearAllCallLogs:", error.message);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getCallOptions, logCall, deleteCallLog, clearAllCallLogs };