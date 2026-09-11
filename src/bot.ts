import { Bot, Context, UserFromGetMe } from "grammy";
import { Env } from "./env";

export type BotContext = Context & { env: Env };

export function createBot(env: Env, botInfo?: UserFromGetMe) {
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN, botInfo ? { botInfo } : undefined);

  // ➕ NEW: Start command to show instructions
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🤖 **Media Upload Bot**\n\n" +
      "1️⃣ *Upload:* Reply to any media with:\n" +
      "`/reply Title | Description | Country`\n\n" +
      "2️⃣ *Delete:* Remove media using its ID:\n" +
      "`/delete <id>`",
      { parse_mode: "Markdown" }
    );
  });

  // ⬆️ EXISTING: Upload command
  bot.command("reply", async (ctx) => {
    const replyMessage = ctx.message?.reply_to_message;

    if (!replyMessage) {
      return ctx.reply(
        "⚠️ Please *reply* to a media message (video, photo, or document) with this command.",
        { parse_mode: "Markdown" }
      );
    }

    let fileId = "";
    let mediaType: "image" | "video" | "document" | null = null;
    let originalFileName = "";

    if (replyMessage.photo) {
      fileId = replyMessage.photo[replyMessage.photo.length - 1].file_id;
      mediaType = "image";
    } else if (replyMessage.video) {
      fileId = replyMessage.video.file_id;
      mediaType = "video";
      originalFileName = replyMessage.video.file_name || "";
    } else if (replyMessage.document) {
      fileId = replyMessage.document.file_id;
      mediaType = "document";
      originalFileName = replyMessage.document.file_name || "";
    }

    if (!fileId || !mediaType) {
      return ctx.reply("❌ The replied message is not a valid image, video, or document.");
    }

    const text = ctx.message?.text || "";
    const args = text.replace(/^\/reply\s*/i, "").trim();
    const parts = args.split("|").map((p) => p.trim());

    if (parts.length < 3) {
      return ctx.reply(
        "⚠️ Invalid format. Please use:\n" +
        "`/reply <title> | <description> | <country>`\n\n" +
        "💡 *Example:*\n" +
        "`/reply Sunset in Lisbon | Golden hour | Portugal`",
        { parse_mode: "Markdown" }
      );
    }

    const [title, description, country] = parts;
    const processingMsg = await ctx.reply("⏳ Fetching media and uploading. Please wait...");

    try {
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) throw new Error("Could not retrieve file path from Telegram");

      const tgUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const tgResponse = await fetch(tgUrl);
      
      if (!tgResponse.ok) throw new Error(`Failed to download media: ${tgResponse.statusText}`);

      const arrayBuffer = await tgResponse.arrayBuffer();

      let mimeType = tgResponse.headers.get("Content-Type")?.split(";")[0].trim() || "";

      if (!mimeType || mimeType === "application/octet-stream") {
        const ext = (originalFileName || "").split(".").pop()?.toLowerCase();
        if (ext === "png") mimeType = "image/png";
        else if (ext === "webp") mimeType = "image/webp";
        else if (ext === "gif") mimeType = "image/gif";
        else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
        else if (ext === "mp4") mimeType = "video/mp4";
        else if (ext === "mov") mimeType = "video/quicktime";
      }

      if (!mimeType || mimeType === "application/octet-stream") {
        mimeType = mediaType === "image" ? "image/jpeg" : "video/mp4";
      }

      let extension = "jpg";
      if (mimeType.includes("png")) extension = "png";
      else if (mimeType.includes("webp")) extension = "webp";
      else if (mimeType.includes("gif")) extension = "gif";
      else if (mimeType.includes("mp4")) extension = "mp4";
      else if (mimeType.includes("quicktime")) extension = "mov";

      const fileName = originalFileName || `upload.${extension}`;
      const typedBlob = new Blob([arrayBuffer], { type: mimeType });

      const formData = new FormData();
      formData.append("file", typedBlob, fileName);
      formData.append("title", title);
      formData.append("description", description);
      formData.append("country", country);

      // Service Binding fetch for upload
      const apiResponse = await env.MEDIA_API.fetch("https://internal/api/media", {
        method: "POST",
        headers: {
          "x-api-key": env.MEDIA_API_KEY,
        },
        body: formData,
      });

      const status = apiResponse.status;
      const responseText = await apiResponse.text();

      if (apiResponse.ok) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `✅ **Upload Successful!**\n**Status:** \`${status}\`\n**Response:**\n\`\`\`json\n${responseText}\n\`\`\``,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `❌ **Upload Failed!**\n**Status:** \`${status}\`\n**Response:**\n\`\`\`json\n${responseText}\n\`\`\``,
          { parse_mode: "Markdown" }
        );
      }

    } catch (error: any) {
      console.error("Upload error:", error);
      await ctx.api.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        `⚠️ An error occurred during upload:\n\`${error.message}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  // ➕ NEW: Delete command
  bot.command("delete", async (ctx) => {
    const args = ctx.message?.text?.split(/\s+/);
    if (!args || args.length < 2) {
      return ctx.reply(
        "❌ **Usage:** `/delete <media_id>`\n\n" +
        "💡 *Example:*\n" +
        "`/delete 12345`",
        { parse_mode: "Markdown" }
      );
    }

    const mediaId = args[1];
    const processingMsg = await ctx.reply(`🔄 Attempting to delete media with ID: \`${mediaId}\`...`, { parse_mode: "Markdown" });

    try {
      // ⚠️ NOTE: Assuming your API uses DELETE /api/media/:id
      // If your API uses separate endpoints like /api/images/:id and /api/videos/:id, 
      // you may need to adjust the URL below or add fallback logic.
      const apiResponse = await env.MEDIA_API.fetch(`https://internal/api/media/${mediaId}`, {
        method: "DELETE",
        headers: {
          "x-api-key": env.MEDIA_API_KEY,
        },
      });

      const status = apiResponse.status;
      const responseText = await apiResponse.text();

      if (apiResponse.ok) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `✅ **Successfully deleted!**\n` +
          `**Status:** \`${status}\`\n` +
          `**Response:** \`${responseText}\``,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `❌ **Failed to delete.**\n` +
          `**Status:** \`${status}\`\n` +
          `**Response:** \`${responseText}\``,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error: any) {
      console.error("Delete error:", error);
      await ctx.api.editMessageText(
        ctx.chat.id,
        processingMsg.message_id,
        `⚠️ An error occurred during deletion:\n\`${error.message}\``,
        { parse_mode: "Markdown" }
      );
    }
  });

  return bot;
}
