const asyncHandler = require("express-async-handler");
const Message = require("../models/Message");
const Chat = require("../models/Chat");
const User = require("../models/User");

// ======================================================
// Send Message
// ======================================================
const sendMessage = asyncHandler(async (req, res) => {
  const {
    content,
    chatId,
    fileUrl,
    fileType,
    poll,
    replyTo,
  } = req.body;

  if (!chatId) {
    return res.status(400).json({
      message: "Chat ID is required",
    });
  }

  const newMessage = {
    sender: req.user._id,
    content: content || "",
    chat: chatId,
    fileUrl: fileUrl || "",
    fileType: fileType || "",
    poll: poll || {
      question: "",
      options: [],
    },
    replyTo: replyTo || null,
  };

  try {
    let message = await Message.create(newMessage);

    message = await Message.findById(message._id)
      .populate("sender", "name phone profilePicture")
      .populate("reactions.user", "name profilePicture")
      .populate({
        path: "poll.options.votes",
        select: "name phone profilePicture",
      })
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "name",
        },
      })
      .populate("chat");

    await Chat.findByIdAndUpdate(chatId, {
      latestMessage: message._id,
    });

    const io = req.app.get("io");

    if (io) {
      const chat = await Chat.findById(chatId).populate(
        "users",
        "name phone profilePicture email"
      );

      if (chat && chat.users) {
        chat.users.forEach((user) => {
          const userId = (
            user?._id || user
          ).toString();

          // Emit only "message received" to prevent double-counting unread counts on the client
          io.to(userId).emit(
            "message received",
            message
          );
        });
      }
    }

    return res.status(201).json(message);
  } catch (error) {
    console.error("Error sending message:", error);

    return res.status(500).json({
      message: error.message || "Failed to send message",
    });
  }
});

// ======================================================
// All Messages
// ======================================================
const allMessages = asyncHandler(async (req, res) => {
  try {
    const messages = await Message.find({
      chat: req.params.chatId,
      deletedFor: {
        $ne: req.user._id,
      },
    })
      .populate("sender", "name phone profilePicture")
      .populate("reactions.user", "name profilePicture")
      .populate({
        path: "poll.options.votes",
        select: "name phone profilePicture",
      })
      .populate({
        path: "replyTo",
        populate: {
          path: "sender",
          select: "name",
        },
      })
      .populate("chat")
      .sort({ createdAt: 1 });

    const normalizedMessages = messages.map((message) => {
      const messageObject = message.toObject();

      if (messageObject.isDeleted) {
        messageObject.content =
          "🚫 This message was deleted";
        messageObject.fileUrl = "";
        messageObject.fileType = "";
        messageObject.poll = {
          question: "",
          options: [],
        };
        messageObject.reactions = [];
        messageObject.replyTo = null;
        messageObject.isEdited = false;
      }

      return messageObject;
    });

    return res.status(200).json(normalizedMessages);
  } catch (error) {
    console.error("Error fetching messages:", error);

    return res.status(500).json({
      message:
        error.message || "Failed to fetch messages",
    });
  }
});

// ======================================================
// Mark Messages as Read
// ======================================================
const markAsRead = asyncHandler(async (req, res) => {
  try {
    const chatId = req.params.chatId;
    const userId = req.user._id;

    await Message.updateMany(
      {
        chat: chatId,
        sender: {
          $ne: userId,
        },
        readBy: {
          $ne: userId,
        },
      },
      {
        $addToSet: {
          readBy: userId,
        },
      }
    );

    return res.status(200).json({
      message: "Messages marked as read",
    });
  } catch (error) {
    console.error(
      "Error marking messages as read:",
      error
    );

    return res.status(500).json({
      message:
        error.message ||
        "Failed to mark messages as read",
    });
  }
});

// ======================================================
// Edit Message
// ======================================================
const editMessage = asyncHandler(async (req, res) => {
  const messageId = req.params.id;
  const { content } = req.body;
  const userId = req.user._id;

  try {
    const message = await Message.findById(
      messageId
    );

    if (!message) {
      return res.status(404).json({
        message: "Message not found",
      });
    }

    if (
      message.sender.toString() !==
      userId.toString()
    ) {
      return res.status(403).json({
        message:
          "You can only edit your own messages",
      });
    }

    if (message.isDeleted) {
      return res.status(400).json({
        message:
          "Deleted messages cannot be edited",
      });
    }

    message.content = content;
    message.isEdited = true;

    await message.save();

    const populatedMessage =
      await Message.findById(message._id)
        .populate(
          "sender",
          "name phone profilePicture"
        )
        .populate(
          "reactions.user",
          "name profilePicture"
        )
        .populate({
          path: "poll.options.votes",
          select: "name phone profilePicture",
        })
        .populate({
          path: "replyTo",
          populate: {
            path: "sender",
            select: "name",
          },
        })
        .populate("chat");

    const io = req.app.get("io");

    if (io && populatedMessage.chat) {
      const chatId =
        populatedMessage.chat._id.toString();

      io.to(chatId).emit(
        "message edited",
        populatedMessage
      );
    }

    return res.status(200).json(
      populatedMessage
    );
  } catch (error) {
    console.error("Error editing message:", error);

    return res.status(500).json({
      message:
        error.message || "Failed to edit message",
    });
  }
});

// ======================================================
// Delete Message
// ======================================================
const deleteMessage = asyncHandler(
  async (req, res) => {
    const { deleteType } = req.body;
    const messageId = req.params.id;
    const userId = req.user._id;

    try {
      const message = await Message.findById(
        messageId
      ).populate("chat");

      if (!message) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      const chat = message.chat;

      if (!chat) {
        return res.status(404).json({
          message: "Chat not found",
        });
      }

      const isGroupChat =
        chat.isGroupChat;

      const isAdmin =
        isGroupChat &&
        chat.groupAdmin &&
        chat.groupAdmin
          .toString() ===
          userId.toString();

      const isOwner =
        message.sender.toString() ===
        userId.toString();

      // ==================================================
      // DELETE FOR EVERYONE
      // ==================================================
      if (deleteType === "forEveryone") {
        if (isGroupChat) {
          if (!isAdmin && !isOwner) {
            return res.status(403).json({
              message:
                "Only the group admin can delete other users' messages for everyone.",
            });
          }
        } else {
          if (!isOwner) {
            return res.status(403).json({
              message:
                "You can only delete your own messages for everyone",
            });
          }
        }

        // -----------------------------------------------
        // Mark message as deleted
        // -----------------------------------------------
        message.isDeleted = true;

        message.content =
          "🚫 This message was deleted";

        message.fileUrl = "";
        message.fileType = "";

        message.poll = {
          question: "",
          options: [],
        };

        message.reactions = [];
        message.replyTo = null;
        message.isEdited = false;

        await message.save();

        // -----------------------------------------------
        // IMPORTANT:
        // Keep the same message as latestMessage
        // -----------------------------------------------
        await Chat.findByIdAndUpdate(
          chat._id,
          {
            latestMessage: message._id,
          }
        );

        // -----------------------------------------------
        // Get fully populated deleted message
        // -----------------------------------------------
        const populatedMessage =
          await Message.findById(
            message._id
          )
            .populate(
              "sender",
              "name phone profilePicture"
            )
            .populate(
              "reactions.user",
              "name profilePicture"
            )
            .populate({
              path: "poll.options.votes",
              select: "name phone profilePicture",
            })
            .populate({
              path: "replyTo",
              populate: {
                path: "sender",
                select: "name",
              },
            })
            .populate("chat");

        // -----------------------------------------------
        // Socket notification
        // -----------------------------------------------
        const io = req.app.get("io");

        if (io && chat) {
          const fullChat =
            await Chat.findById(chat._id)
              .populate(
                "users",
                "name phone profilePicture email"
              )
              .populate({
                path: "latestMessage",
                populate: {
                  path: "sender",
                  select: "name phone profilePicture",
                },
              });

          if (
            fullChat &&
            fullChat.users
          ) {
            fullChat.users.forEach(
              (u) => {
                const userRoomId = (
                  u?._id || u
                ).toString();

                if (!userRoomId) return;

                io.to(userRoomId).emit(
                  "message deleted",
                  {
                    messageId:
                      message._id,
                    chatId:
                      chat._id,
                    message:
                      populatedMessage,
                  }
                );
              }
            );
          }
        }

        return res.status(200).json({
          type: "forEveryone",
          message: populatedMessage,
        });
      }

      // ==================================================
      // DELETE FOR ME
      // ==================================================
      if (deleteType === "forMe") {
        await Message.findByIdAndUpdate(
          messageId,
          {
            $addToSet: {
              deletedFor: userId,
            },
          }
        );

        const latestRemaining =
          await Message.findOne({
            chat: chat._id,
            deletedFor: {
              $ne: userId,
            },
          })
            .sort({
              createdAt: -1,
            })
            .populate(
              "sender",
              "name phone profilePicture"
            );

        return res.status(200).json({
          type: "forMe",
          messageId: message._id,
          chatId: chat._id,
          latestMessage:
            latestRemaining || null,
        });
      }

      // ==================================================
      // INVALID DELETE TYPE
      // ==================================================
      return res.status(400).json({
        message:
          "Invalid deleteType provided",
      });
    } catch (error) {
      console.error(
        "Error in deleteMessage:",
        error
      );

      return res.status(500).json({
        message:
          error.message ||
          "Failed to delete message",
      });
    }
  }
);

// ======================================================
// Delete Multiple Messages (Bulk Delete)
// ======================================================
const deleteMultipleMessages = asyncHandler(async (req, res) => {
  const { messageIds, deleteType } = req.body;
  const userId = req.user._id;

  if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
    return res.status(400).json({ message: "Message IDs array is required" });
  }

  try {
    const messages = await Message.find({ _id: { $in: messageIds } }).populate("chat");

    if (!messages || messages.length === 0) {
      return res.status(404).json({ message: "Messages not found" });
    }

    const chatId = messages[0].chat._id;
    const chat = messages[0].chat;

    const isGroupChat = chat.isGroupChat;
    const isAdmin =
      isGroupChat &&
      chat.groupAdmin &&
      chat.groupAdmin.some((adminId) => adminId.toString() === userId.toString());

    if (deleteType === "forEveryone") {
      for (const msg of messages) {
        const isOwner = msg.sender.toString() === userId.toString();
        if (isGroupChat) {
          if (!isAdmin && !isOwner) {
            return res.status(403).json({
              message: "You can only delete your own messages for everyone unless you are an admin.",
            });
          }
        } else {
          if (!isOwner) {
            return res.status(403).json({
              message: "You can only delete your own messages for everyone.",
            });
          }
        }
      }

      await Message.updateMany(
        { _id: { $in: messageIds } },
        {
          $set: {
            isDeleted: true,
            content: "🚫 This message was deleted",
            fileUrl: "",
            fileType: "",
            poll: { question: "", options: [] },
            reactions: [],
            replyTo: null,
            isEdited: false,
          },
        }
      );

      const latestMsg = await Message.findOne({ chat: chatId }).sort({ createdAt: -1 });
      if (latestMsg) {
        await Chat.findByIdAndUpdate(chatId, { latestMessage: latestMsg._id });
      }

      const io = req.app.get("io");
      if (io) {
        const fullChat = await Chat.findById(chatId)
          .populate("users", "name phone profilePicture email")
          .populate({
            path: "latestMessage",
            populate: {
              path: "sender",
              select: "name phone profilePicture",
            },
          });

        if (fullChat && fullChat.users) {
          fullChat.users.forEach((u) => {
            const userRoomId = (u?._id || u).toString();
            if (!userRoomId) return;

            messageIds.forEach((msgId) => {
              io.to(userRoomId).emit("message deleted", {
                messageId: msgId,
                chatId: chatId.toString(),
              });
            });

            io.to(userRoomId).emit("chat updated", {
              chatId: chatId.toString(),
              latestMessage: fullChat.latestMessage,
              chat: fullChat,
            });
          });
        }
      }

      return res.status(200).json({
        type: "forEveryone",
        messageIds,
        chatId,
      });
    } else if (deleteType === "forMe") {
      await Message.updateMany(
        { _id: { $in: messageIds } },
        { $addToSet: { deletedFor: userId } }
      );

      const latestRemaining = await Message.findOne({
        chat: chatId,
        deletedFor: { $ne: userId },
      })
        .sort({ createdAt: -1 })
        .populate("sender", "name phone profilePicture");

      return res.status(200).json({
        type: "forMe",
        messageIds,
        chatId,
        latestMessage: latestRemaining || null,
      });
    }

    return res.status(400).json({ message: "Invalid deleteType provided" });
  } catch (error) {
    console.error("Error in deleteMultipleMessages:", error);
    return res.status(500).json({
      message: error.message || "Failed to delete messages",
    });
  }
});

// ======================================================
// React to Message
// ======================================================
const reactToMessage = asyncHandler(
  async (req, res) => {
    const messageId = req.params.id;
    const { emoji } = req.body;
    const userId = req.user._id;

    try {
      const message =
        await Message.findById(messageId);

      if (!message) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      if (message.isDeleted) {
        return res.status(400).json({
          message:
            "Cannot react to a deleted message",
        });
      }

      const existingReaction =
        message.reactions.find(
          (reaction) =>
            reaction.user.toString() ===
            userId.toString()
        );

      if (existingReaction) {
        if (existingReaction.emoji === emoji) {
          message.reactions =
            message.reactions.filter(
              (reaction) =>
                reaction.user.toString() !==
                userId.toString()
            );
        } else {
          existingReaction.emoji = emoji;
        }
      } else {
        message.reactions.push({
          user: userId,
          emoji,
        });
      }

      await message.save();

      const populatedMessage =
        await Message.findById(
          message._id
        )
          .populate(
            "sender",
            "name phone profilePicture"
          )
          .populate(
            "reactions.user",
            "name profilePicture"
          )
          .populate({
            path: "poll.options.votes",
            select: "name phone profilePicture",
          })
          .populate({
            path: "replyTo",
            populate: {
              path: "sender",
              select: "name",
            },
          })
          .populate("chat");

      const io = req.app.get("io");

      if (
        io &&
        populatedMessage.chat
      ) {
        io.to(
          populatedMessage.chat._id.toString()
        ).emit(
          "message reaction",
          populatedMessage
        );
      }

      return res.status(200).json(
        populatedMessage
      );
    } catch (error) {
      console.error(
        "Error reacting to message:",
        error
      );

      return res.status(500).json({
        message:
          error.message ||
          "Failed to react to message",
      });
    }
  }
);

// ======================================================
// Vote Poll
// ======================================================
const votePoll = asyncHandler(
  async (req, res) => {
    const { messageId, optionId } =
      req.body;

    const userId = req.user._id;

    try {
      const message =
        await Message.findById(messageId);

      if (!message) {
        return res.status(404).json({
          message: "Message not found",
        });
      }

      if (message.isDeleted) {
        return res.status(400).json({
          message:
            "Cannot vote on a deleted message",
        });
      }

      if (
        !message.poll ||
        !message.poll.options ||
        message.poll.options.length === 0
      ) {
        return res.status(400).json({
          message:
            "This message does not contain a poll",
        });
      }

      const option =
        message.poll.options.id(
          optionId
        );

      if (!option) {
        return res.status(404).json({
          message: "Poll option not found",
        });
      }

      // Remove previous vote
      message.poll.options.forEach(
        (pollOption) => {
          pollOption.votes =
            pollOption.votes.filter(
              (vote) =>
                vote.toString() !==
                userId.toString()
            );
        }
      );

      // Add new vote
      option.votes.push(userId);

      await message.save();

      const populatedMessage =
        await Message.findById(
          message._id
        )
          .populate(
            "sender",
            "name phone profilePicture"
          )
          .populate(
            "reactions.user",
            "name profilePicture"
          )
          .populate({
            path: "poll.options.votes",
            select: "name phone profilePicture",
          })
          .populate({
            path: "replyTo",
            populate: {
              path: "sender",
              select: "name",
            },
          })
          .populate("chat");

      const io = req.app.get("io");

      if (
        io &&
        populatedMessage.chat
      ) {
        io.to(
          populatedMessage.chat._id.toString()
        ).emit(
          "poll updated",
          populatedMessage
        );
      }

      return res.status(200).json(
        populatedMessage
      );
    } catch (error) {
      console.error(
        "Error voting on poll:",
        error
      );

      return res.status(500).json({
        message:
          error.message ||
          "Failed to vote on poll",
      });
    }
  }
);

// ======================================================
// Clear Chat
// ======================================================
const clearChat = asyncHandler(
  async (req, res) => {
    const chatId = req.params.chatId;
    const userId = req.user._id;

    try {
      const chat =
        await Chat.findById(chatId);

      if (!chat) {
        return res.status(404).json({
          message: "Chat not found",
        });
      }

      const isMember =
        chat.users.some(
          (id) =>
            id.toString() ===
            userId.toString()
        );

      if (!isMember) {
        return res.status(403).json({
          message:
            "You are not a member of this chat",
        });
      }

      await Message.updateMany(
        {
          chat: chatId,
        },
        {
          $addToSet: {
            deletedFor: userId,
          },
        }
      );

      return res.status(200).json({
        message: "Chat cleared successfully",
        chatId,
      });
    } catch (error) {
      console.error(
        "Error clearing chat:",
        error
      );

      return res.status(500).json({
        message:
          error.message ||
          "Failed to clear chat",
      });
    }
  }
);

module.exports = {
  sendMessage,
  allMessages,
  markAsRead,
  editMessage,
  deleteMessage,
  deleteMultipleMessages,
  reactToMessage,
  votePoll,
  clearChat,
};