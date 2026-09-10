import { Bot, Context } from "grammy";
import { Env } from "./env";

export type BotContext = Context & { env: Env };

export function createBot(env: Env) {
  const bot = new Bot<BotContext>(env.TELEGRAM_BOT_TOKEN);

  bot.command("reply", async (ctx) => {
    const replyMessage = ctx.message?.reply_to_message;

    if (!replyMessage) {
      return ctx.reply(
        "⚠️ Please *reply* to a media message (video, photo, or document) with this command.",
        { parse_mode: "Markdown" }
      );
    }

    // 1. Extract file metadata
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

    // 2. Parse arguments: <title> | <description> | <country>
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

    // 3. Acknowledge immediately to prevent Telegram timeout
    const processingMsg = await ctx.reply("⏳ Fetching media and uploading. Please wait...");

    try {
      // 4. Fetch file metadata and download directly into memory
      const file = await ctx.api.getFile(fileId);
      if (!file.file_path) {
        throw new Error("Could not retrieve file path from Telegram");
      }

      const tgUrl = `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
      const tgResponse = await fetch(tgUrl);
      
      if (!tgResponse.ok) {
        throw new Error(`Failed to download media from Telegram: ${tgResponse.statusText}`);
      }

      // 👇 CRITICAL FIX FOR CLOUDFLARE WORKERS 👇
      // Get raw binary data as ArrayBuffer to avoid Node.js fs dependencies
      const arrayBuffer = await tgResponse.arrayBuffer();

      // 👇 ROBUST MIME TYPE RESOLUTION 👇
      let mimeType = tgResponse.headers.get("Content-Type")?.split(";")[0].trim() || "";

      if (!mimeType || mimeType === "application/octet-stream") {
        const docName = originalFileName || "";
        const ext = docName.split(".").pop()?.toLowerCase();
        if (ext === "png") mimeType = "image/png";
        else if (ext === "webp") mimeType = "image/webp";
        else if (ext === "gif") mimeType = "image/gif";
        else if (ext === "jpg" || ext === "jpeg") mimeType = "image/jpeg";
        else if (ext === "mp4") mimeType = "video/mp4";
        else if (ext === "mov") mimeType = "video/quicktime";
        else if (ext === "pdf") mimeType = "application/pdf";
      }

      // Final fallback based on detected media type
      if (!mimeType || mimeType === "application/octet-stream") {
        mimeType = mediaType === "image" ? "image/jpeg" : "video/mp4";
      }

      // Determine correct file extension based on resolved MIME type
      let extension = "jpg";
      if (mimeType.includes("png")) extension = "png";
      else if (mimeType.includes("webp")) extension = "webp";
      else if (mimeType.includes("gif")) extension = "gif";
      else if (mimeType.includes("mp4")) extension = "mp4";
      else if (mimeType.includes("quicktime")) extension = "mov";
      else if (mimeType.includes("pdf")) extension = "pdf";

      const fileName = originalFileName || `upload.${extension}`;

      // 👇 FORCE CORRECT MIME TYPE IN BLOB 👇
      // When using tgResponse.blob(), Cloudflare might default to application/octet-stream.
      // Creating a new Blob from the arrayBuffer forces the correct MIME type.
      const typedBlob = new Blob([arrayBuffer], { type: mimeType });

      // 5. Prepare FormData for the target API
      const formData = new FormData();
      formData.append("file", typedBlob, fileName);
      formData.append("title", title);
      formData.append("description", description);
      formData.append("country", country);

      // 6. Upload to the target API
      const apiResponse = await fetch("https://media-api.you.workers.dev/api/media", {
        method: "POST",
        headers: {
          "x-api-key": env.MEDIA_API_KEY,
        },
        body: formData,
      });

      const status = apiResponse.status;
      const responseText = await apiResponse.text();

      // 7. Update the user with the actual status
      if (apiResponse.ok) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `✅ **Upload Successful!**\n` +
          `**Status:** \`${status}\`\n` +
          `**Response:**\n\`\`\`json\n${responseText}\n\`\`\``,
          { parse_mode: "Markdown" }
        );
      } else {
        await ctx.api.editMessageText(
          ctx.chat.id,
          processingMsg.message_id,
          `❌ **Upload Failed!**\n` +
          `**Status:** \`${status}\`\n` +
          `**Response:**\n\`\`\`json\n${responseText}\n\`\`\``,
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

  return bot;
}
