const Chat = require("../models/Chat");
const User = require("../models/User");
const Message = require("../models/Message");

// Helper function to create and broadcast a system activity message in real time
const createAndBroadcastSystemMessage = async (req, chatId, content, targetChat) => {
  try {
    const systemMessage = await Message.create({
      sender: req.user._id,
      content,
      chat: chatId,
      readBy: [req.user._id],
      isSystemMessage: true,
      deletedFor: [],
    });

    const populatedSystemMessage = await Message.findById(systemMessage._id)
      .populate("sender", "name phone profilePicture")
      .populate("chat");

    await Chat.findByIdAndUpdate(chatId, {
      latestMessage: systemMessage._id,
    });

    const io = req.app.get("io");
    if (io) {
      const chatIdStr = chatId.toString();
      io.to(chatIdStr).emit("message received", populatedSystemMessage);

      const recipientUsers = targetChat?.users || [];
      recipientUsers.forEach((u) => {
        const uIdStr = (u?._id || u)?.toString();
        if (uIdStr) {
          io.to(uIdStr).emit("chat updated", {
            chatId: chatIdStr,
            latestMessage: populatedSystemMessage,
            chat: targetChat,
          });
        }
      });
    }

    return populatedSystemMessage;
  } catch (error) {
    console.error("Error creating group system message:", error);
    return null;
  }
};

// ======================================================
// ACCESS / CREATE CHAT
// ======================================================
const accessChat = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!req.user || !req.user._id) {
      return res.status(401).json({
        message: "User is not authenticated",
      });
    }

    const currentUserId = req.user._id;

    if (!userId) {
      return res.status(400).json({
        message: "User ID is required",
      });
    }

    // ==================================================
    // SELF CHAT
    // ==================================================
    if (currentUserId.toString() === userId.toString()) {
      let selfChat = await Chat.findOne({
        isGroupChat: false,
        $expr: {$and: [
            { $eq: [{ $size: "$users" }, 2] },
            {
              $eq: [
                { $arrayElemAt: ["$users", 0] },
                currentUserId,
              ],
            },
            {
              $eq: [
                { $arrayElemAt: ["$users", 1] },
                currentUserId,
              ],
            },
          ],
        },
      })
        .populate("users", "-password")
        .populate("latestMessage");

      if (!selfChat) {
        const createdChat = await Chat.create({
          chatName: "You",
          isGroupChat: false,
          users: [currentUserId, currentUserId],
        });

        selfChat = await Chat.findById(createdChat._id)
          .populate("users", "-password")
          .populate("latestMessage");
      }

      return res.status(200).json(selfChat);
    }

    // ==================================================
    // NORMAL ONE-TO-ONE CHAT
    // ==================================================
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    let chat = await Chat.findOne({
      isGroupChat: false,
      users: {
        $all: [currentUserId, userId],
      },
    })
      .populate("users", "-password")
      .populate("latestMessage");

    if (!chat) {
      const createdChat = await Chat.create({
        chatName: "sender",
        isGroupChat: false,
        users: [currentUserId, userId],
      });

      chat = await Chat.findById(createdChat._id)
        .populate("users", "-password")
        .populate("latestMessage");
    }

    return res.status(200).json(chat);
  } catch (error) {
    console.error("Error accessing chat:", error);

    return res.status(500).json({
      message: "Failed to access chat",
      error: error.message,
    });
  }
};

// ======================================================
// FETCH ALL CHATS FOR LOGGED-IN USER (With AI, Self-Chat Auto-Provisioning & Cleared/Deleted Normalization)
// ======================================================
const fetchChats = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        message: "User is not authenticated",
      });
    }

    const currentUserId = req.user._id;

    // 1. Ensure Meta AI Bot chat exists for this user
    let aiChat = await Chat.findOne({
      isAIBot: true,
      users: currentUserId,
    });

    if (!aiChat) {
      await Chat.create({
        chatName: "Meta AI",
        isAIBot: true,
        users: [currentUserId, currentUserId],
        isGroupChat: false,
      });
    }

    // 2. Ensure Self-Chat exists for this user
    let selfChat = await Chat.findOne({
      isGroupChat: false,
      isAIBot: { $ne: true },
      $expr: {$and: [
          { $eq: [{ $size: "$users" }, 2] },
          { $eq: [{ $arrayElemAt: ["$users", 0] }, currentUserId] },
          { $eq: [{ $arrayElemAt: ["$users", 1] }, currentUserId] },
        ],
      },
    });

    if (!selfChat) {
      await Chat.create({
        chatName: "You",
        isGroupChat: false,
        users: [currentUserId, currentUserId],
      });
    }

    // 3. Fetch all chats for the logged-in user
    let chats = await Chat.find({
      users: {
        $elemMatch: {$eq: currentUserId },
      },
    })
      .lean()
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate({
        path: "latestMessage",
        populate: {
          path: "sender",
          select: "name phone profilePicture",
        },
      })
      .sort({ updatedAt: -1 });

    // Normalize deleted or cleared latest messages per user and map isFavourite
    chats = chats.map((chat) => {
      const chatObj = chat;
      
      // Check if current user favorited this chat
      chatObj.isFavourite = (chatObj.favouriteBy || []).some(
        (id) => id.toString() === currentUserId.toString()
      );

      if (chatObj.latestMessage) {
        if (chatObj.latestMessage.isDeleted) {
          chatObj.latestMessage.content = "🚫 This message was deleted";
          chatObj.latestMessage.fileUrl = "";
          chatObj.latestMessage.fileType = "";
        }
        
        if (
          chatObj.latestMessage.deletedFor &&
          chatObj.latestMessage.deletedFor.some(
            (id) => id.toString() === currentUserId.toString()
          )
        ) {
          chatObj.latestMessage = null;
        }
      }
      return chatObj;
    });

    return res.status(200).json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);

    return res.status(500).json({
      message: "Failed to fetch chats",
      error: error.message,
    });
  }
};

// ======================================================
// CREATE GROUP CHAT
// ======================================================
const createGroupChat = async (req, res) => {
  try {
    const { name, users } = req.body;

    if (!name || !users) {
      return res.status(400).json({
        message: "Please provide group name and users",
      });
    }

    let parsedUsers;

    try {
      parsedUsers =
        typeof users === "string"
          ? JSON.parse(users)
          : users;
    } catch (error) {
      return res.status(400).json({
        message: "Invalid users data",
      });
    }

    if (!Array.isArray(parsedUsers) || parsedUsers.length < 2) {
      return res.status(400).json({
        message:
          "More than 2 users are required to create a group chat",
      });
    }

    parsedUsers.push(req.user._id);

    const uniqueUsers = [
      ...new Set(
        parsedUsers.map((id) => id.toString())
      ),
    ];

    const groupChat = await Chat.create({
      chatName: name,
      users: uniqueUsers,
      isGroupChat: true,
      groupAdmin: [req.user._id],
    });

    const fullGroupChat = await Chat.findById(groupChat._id)
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    const creatorName = req.user.name || "Admin";
    await createAndBroadcastSystemMessage(
      req,
      groupChat._id,
      `${creatorName} created group "${name}"`,
      fullGroupChat
    );

    return res.status(201).json(fullGroupChat);
  } catch (error) {
    console.error("Error creating group chat:", error);

    return res.status(500).json({
      message: "Failed to create group chat",
      error: error.message,
    });
  }
};

// ======================================================
// RENAME GROUP
// ======================================================
const renameGroup = async (req, res) => {
  try {
    const { chatId, chatName } = req.body;

    if (!chatId || !chatName) {
      return res.status(400).json({
        message: "Chat ID and chat name are required",
      });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      {
        chatName: chatName.trim(),
      },
      {
        returnDocument: "after",
      }
    )
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    if (!updatedChat) {
      return res.status(404).json({
        message: "Chat not found",
      });
    }

    const actorName = req.user.name || "Admin";
    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${actorName} changed the group name to "${chatName.trim()}"`,
      updatedChat
    );

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error renaming group:", error);

    return res.status(500).json({
      message: "Failed to rename group",
      error: error.message,
    });
  }
};

// ======================================================
// ADD USER TO GROUP
// ======================================================
const addToGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({
        message: "Chat ID and user ID are required",
      });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({
        message: "Chat not found",
      });
    }

    if (!chat.isGroupChat) {
      return res.status(400).json({
        message: "This is not a group chat",
      });
    }

    const alreadyMember = chat.users.some(
      (id) => id.toString() === userId.toString()
    );

    if (alreadyMember) {
      return res.status(400).json({
        message: "User is already in the group",
      });
    }

    chat.users.push(userId);
    await chat.save();

    const updatedChat = await Chat.findById(chatId)
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const actorName = req.user.name || "Admin";
    const addedUser = await User.findById(userId);
    const targetUserName = addedUser ? addedUser.name : "a member";

    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${actorName} added ${targetUserName}`,
      updatedChat
    );

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error adding user to group:", error);

    return res.status(500).json({
      message: "Failed to add user to group",
      error: error.message,
    });
  }
};

// ======================================================
// REMOVE USER FROM GROUP
// ======================================================
const removeFromGroup = async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({
        message: "Chat ID and user ID are required",
      });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({
        message: "Chat not found",
      });
    }

    if (!chat.isGroupChat) {
      return res.status(400).json({
        message: "This is not a group chat",
      });
    }

    const removedUser = await User.findById(userId);
    const targetUserName = removedUser ? removedUser.name : "a member";

    chat.users = chat.users.filter(
      (id) => id.toString() !== userId.toString()
    );

    await chat.save();

    const updatedChat = await Chat.findById(chatId)
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const actorName = req.user.name || "Admin";
    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${actorName} removed ${targetUserName}`,
      updatedChat
    );

    // Notify removed user via socket to instantly remove group from their sidebar and close chat window
    const io = req.app.get("io");
    if (io) {
      io.to(userId.toString()).emit("chat removed", { chatId });
    }

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error removing user from group:", error);

    return res.status(500).json({
      message: "Failed to remove user from group",
      error: error.message,
    });
  }
};

// ======================================================
// LEAVE GROUP
// ======================================================
const leaveGroup = async (req, res) => {
  try {
    const { chatId } = req.body;

    if (!chatId) {
      return res.status(400).json({
        message: "Chat ID is required",
      });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({
        message: "Chat not found",
      });
    }

    if (!chat.isGroupChat) {
      return res.status(400).json({
        message: "This is not a group chat",
      });
    }

    const leavingUserName = req.user.name || "A member";

    chat.users = chat.users.filter(
      (id) => id.toString() !== req.user._id.toString()
    );

    if (chat.users.length === 0) {
      await Chat.findByIdAndDelete(chatId);

      return res.status(200).json({
        message: "You left the group",
        chatId,
      });
    }

    if (
      chat.groupAdmin &&
      Array.isArray(chat.groupAdmin) &&
      chat.groupAdmin.some((adminId) => adminId.toString() === req.user._id.toString())
    ) {
      chat.groupAdmin = chat.groupAdmin.filter((id) => id.toString() !== req.user._id.toString());
      if (chat.groupAdmin.length === 0 && chat.users.length > 0) {
        chat.groupAdmin = [chat.users[0]];
      }
    }

    await chat.save();

    const updatedChat = await Chat.findById(chatId)
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${leavingUserName} left the group`,
      updatedChat
    );

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error leaving group:", error);

    return res.status(500).json({
      message: "Failed to leave group",
      error: error.message,
    });
  }
};

// ======================================================
// TOGGLE GROUP ADMIN
// ======================================================
const toggleGroupAdmin = async (req, res) => {
  try {
    const { chatId, targetUserId } = req.body;

    if (!chatId || !targetUserId) {
      return res.status(400).json({ message: "Chat ID and Target User ID are required" });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isRequesterAdmin = (chat.groupAdmin || []).some(
      (adminId) => adminId.toString() === req.user._id.toString()
    );

    if (!isRequesterAdmin) {
      return res.status(403).json({ message: "Only group admins can change admin roles" });
    }

    const isTargetAdmin = (chat.groupAdmin || []).some(
      (adminId) => adminId.toString() === targetUserId.toString()
    );

    const updateAction = isTargetAdmin
      ? { $pull: { groupAdmin: targetUserId } }
      : { $addToSet: { groupAdmin: targetUserId } };

    const updatedChat = await Chat.findByIdAndUpdate(chatId, updateAction, { new: true })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const actorName = req.user.name || "Admin";
    const targetUser = await User.findById(targetUserId);
    const targetUserName = targetUser ? targetUser.name : "A member";
    const statusText = isTargetAdmin
      ? `${actorName} dismissed ${targetUserName} as admin`
      : `${actorName} made ${targetUserName} a group admin`;

    await createAndBroadcastSystemMessage(req, chatId, statusText, updatedChat);

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error in toggleGroupAdmin:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ======================================================
// UPDATE GROUP PICTURE (Admin Only)
// ======================================================
const updateGroupPicture = async (req, res) => {
  try {
    const { chatId, groupImage } = req.body;

    if (!chatId || !groupImage) {
      return res.status(400).json({ message: "Chat ID and groupImage are required" });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // Strict validation: Only group admins can update group picture
    const isRequesterAdmin = (chat.groupAdmin || []).some(
      (adminId) => (adminId?._id || adminId)?.toString() === req.user._id.toString()
    );

    if (!isRequesterAdmin) {
      return res.status(403).json({ message: "Only group admins can update group picture" });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { groupImage },
      { new: true }
    )
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const actorName = req.user.name || "Admin";
    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${actorName} changed this group's icon`,
      updatedChat
    );

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error in updateGroupPicture:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ======================================================
// UPDATE DISAPPEARING MESSAGES
// ======================================================
const updateDisappearingMessages = async (req, res) => {
  try {
    const { chatId, duration } = req.body;

    if (!chatId || duration === undefined) {
      return res.status(400).json({ message: "Chat ID and duration are required" });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isMember = chat.users.some(
      (userId) => userId.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    const updatedChat = await Chat.findByIdAndUpdate(
      chatId,
      {
        disappearingMessages: {
          duration: Number(duration),
          enabledBy: req.user._id,
        },
      },
      { new: true }
    )
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const actorName = req.user.name || "Admin";
    const durationText = Number(duration) > 0 ? `${duration} hours` : "off";
    await createAndBroadcastSystemMessage(
      req,
      chatId,
      `${actorName} turned disappearing messages ${durationText}`,
      updatedChat
    );

    return res.status(200).json(updatedChat);
  } catch (error) {
    console.error("Error in updateDisappearingMessages:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ======================================================
// TOGGLE FAVOURITE CHAT
// ======================================================
const toggleFavourite = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isMember = chat.users.some((id) => id.toString() === userId.toString());
    if (!isMember) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    const isFavourite = (chat.favouriteBy || []).some(
      (id) => id.toString() === userId.toString()
    );

    const updateAction = isFavourite
      ? { $pull: { favouriteBy: userId } }
      : { $addToSet: { favouriteBy: userId } };

    const updatedChat = await Chat.findByIdAndUpdate(chatId, updateAction, { new: true })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage");

    const chatObj = updatedChat.toObject();
    chatObj.isFavourite = !isFavourite;

    return res.status(200).json(chatObj);
  } catch (error) {
    console.error("Error in toggleFavourite:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ======================================================
// CLEAR CHAT
// ======================================================
const clearChat = async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const isMember = chat.users.some(
      (id) => id.toString() === userId.toString()
    );

    if (!isMember) {
      return res.status(403).json({ message: "Unauthorized action" });
    }

    await Message.updateMany(
      { chat: chatId },
      { $addToSet: { deletedFor: userId } }
    );

    return res.status(200).json({ message: "Chat cleared successfully", chatId });
  } catch (error) {
    console.error("Error in clearChat:", error);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ======================================================
// DELETE CHAT
// ======================================================
const deleteChat = async (req, res) => {
  try {
    const { chatId } = req.params;

    if (!chatId) {
      return res.status(400).json({
        message: "Chat ID is required",
      });
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
      return res.status(404).json({
        message: "Chat not found",
      });
    }

    const isMember = chat.users.some(
      (id) => id.toString() === req.user._id.toString()
    );

    if (!isMember) {
      return res.status(403).json({
        message: "Unauthorized action",
      });
    }

    await Message.deleteMany({
      chat: chatId,
    });

    await Chat.findByIdAndDelete(chatId);

    return res.status(200).json({
      message: "Chat deleted successfully",
      chatId,
    });
  } catch (error) {
    console.error("Error deleting chat:", error);

    return res.status(500).json({
      message: "Failed to delete chat",
      error: error.message,
    });
  }
};

// ======================================================
// EXPORT
// ======================================================
module.exports = {
  accessChat,
  fetchChats,
  createGroupChat,
  renameGroup,
  addToGroup,
  removeFromGroup,
  leaveGroup,
  toggleGroupAdmin,
  updateGroupPicture,
  updateDisappearingMessages,
  toggleFavourite,
  clearChat,
  deleteChat,
};