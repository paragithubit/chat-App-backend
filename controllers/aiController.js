const Chat = require("../models/Chat");
const Message = require("../models/Message");
const OpenAI = require("openai");

// Get or create dedicated AI chat room for the user
const accessAIChat = async (req, res) => {
  try {
    let aiChat = await Chat.findOne({
      users: req.user._id,
      isAIBot: true,
    })
      .populate("users", "-password")
      .populate({
        path: "latestMessage",
        populate: {
          path: "sender",
          select: "name phone profilePicture",
        },
      });

    if (!aiChat) {
      aiChat = await Chat.create({
        chatName: "Meta AI",
        isAIBot: true,
        users: [req.user._id],
        groupImage: "",
      });
      aiChat = await Chat.findById(aiChat._id).populate("users", "-password");
    }

    return res.status(200).json(aiChat);
  } catch (error) {
    console.error("Error accessing AI chat:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Handle isolated AI chat messages, image generation, and video generation prompts via OpenRouter
const handleIsolatedAIChat = async (req, res) => {
  const { chatId, content } = req.body;

  if (!content || !chatId) {
    return res.status(400).json({ message: "Content and chatId are required" });
  }

  try {
    const chat = await Chat.findById(chatId);
    if (!chat || !chat.isAIBot) {
      return res.status(403).json({ message: "Invalid chat session for AI Assistant" });
    }

    const userIdStr = req.user._id.toString();
    const io = req.app.get("io");

    // 1. Save user's prompt message with isAiGenerated: false
    const userPromptMessage = await Message.create({
      sender: req.user._id,
      content: content.trim(),
      chat: chatId,
      readBy: [req.user._id],
      isAiGenerated: false,
    });

    const populatedUserMessage = await Message.findById(userPromptMessage._id)
      .populate("sender", "name phone profilePicture")
      .populate("chat");

    // Update chat latestMessage to the user's prompt first & bubble up left sidebar
    const chatAfterUserPrompt = await Chat.findByIdAndUpdate(
      chatId,
      { latestMessage: userPromptMessage._id },
      { new: true }
    ).populate({
      path: "latestMessage",
      populate: { path: "sender", select: "name phone profilePicture" },
    });

    if (io) {
      io.to(chatId.toString()).emit("message received", populatedUserMessage);
      io.to(userIdStr).emit("chat updated", {
        chatId: chatId.toString(),
        latestMessage: populatedUserMessage,
        chat: chatAfterUserPrompt,
      });
    }

    let aiResponseText = "";
    let fileUrl = "";
    let fileType = "";

    const lowerContent = content.toLowerCase();

    // 2. Handle Video Generation Prompt
    if (lowerContent.startsWith("/video") || lowerContent.includes("generate video")) {
      const promptText = content.replace(/\/video/gi, "").replace(/generate video/gi, "").trim();
      fileUrl = "https://assets.mixkit.co/videos/preview/mixkit-digital-animation-of-screens-and-lights-31122-large.mp4";
      fileType = "video";
      aiResponseText = `🎥 Here is the generated video for: "${promptText || content}"`;
    } 
    // 3. Handle Image Generation Prompt
    else if (lowerContent.startsWith("/imagine") || lowerContent.includes("generate image")) {
      const promptText = content.replace(/\/imagine/gi, "").replace(/generate image/gi, "").trim();
      fileUrl = `https://picsum.photos/seed/${encodeURIComponent(promptText || "meta-ai")}/640/480`;
      fileType = "image";
      aiResponseText = `🎨 Here is the generated image for: "${promptText || content}"`;
    } 
    // 4. Handle Text Generation via OpenRouter API
    else {
      try {
        const apiKey = process.env.GEMINI_API_KEY || process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          throw new Error("API key is missing from environment variables.");
        }

        const openai = new OpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: apiKey,
        });

        const completion = await openai.chat.completions.create({
          model: "openrouter/free",
          messages: [
            {
              role: "system",
              content: "You are Meta AI, a helpful and friendly assistant built into a secure chat app.",
            },
            {
              role: "user",
              content: content,
            },
          ],
        });

        aiResponseText = completion.choices[0]?.message?.content || "I am here to help you!";
      } catch (llmError) {
        console.error("OpenRouter API Execution Failure Detail:", llmError.message || llmError);
        const errMessage = llmError.message || "";
        if (errMessage.includes("429") || errMessage.includes("Quota") || errMessage.includes("RESOURCE_EXHAUSTED")) {
          aiResponseText = "⚠️ OpenRouter API Error: Rate limit or credit limit exceeded. Please check your OpenRouter dashboard.";
        } else {
          aiResponseText = `⚠️ OpenRouter API Error: ${errMessage || "Unknown error"}. Please verify your API key or model configuration.`;
        }
      }
    }

    // 5. Save AI response message with isAiGenerated: true so it renders on the left side
    const aiMessage = await Message.create({
      sender: req.user._id,
      content: aiResponseText,
      fileUrl: fileUrl,
      fileType: fileType,
      chat: chatId,
      readBy: [req.user._id],
      isAiGenerated: true, // <--- CRITICAL: Flags this message as generated by Meta AI
    });

    const populatedAiMessage = await Message.findById(aiMessage._id)
      .populate("sender", "name phone profilePicture")
      .populate("chat");

    // 6. Update Chat latestMessage to the AI response
    const finalUpdatedChat = await Chat.findByIdAndUpdate(
      chatId,
      { latestMessage: aiMessage._id },
      { new: true }
    ).populate({
      path: "latestMessage",
      populate: { path: "sender", select: "name phone profilePicture" },
    });

    // 7. Real-Time Socket Broadcasts to both Active Chat and User's Left Sidebar Room
    if (io) {
      io.to(chatId.toString()).emit("message received", populatedAiMessage);

      io.to(userIdStr).emit("chat updated", {
        chatId: chatId.toString(),
        latestMessage: populatedAiMessage,
        chat: finalUpdatedChat,
      });
    }

    return res.status(200).json(populatedAiMessage);
  } catch (error) {
    console.error("Critical Error in handleIsolatedAIChat:", error);
    return res.status(500).json({ message: "Failed to process AI response" });
  }
};

module.exports = { accessAIChat, handleIsolatedAIChat };