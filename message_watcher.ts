import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import classify from "./classifier";

const watcher = chokidar.watch("./temp/Messages", {
  ignored: /^\./,
  persistent: true,
});
const POST_PATH = "./temp/Extracted";

!fs.existsSync(POST_PATH) && fs.mkdirSync(POST_PATH);

watcher.on("add", async function (filepath) {
  const filename = path.basename(filepath, ".json");
  const data = JSON.parse(fs.readFileSync(filepath).toString());
  const { text, ...messageInfo } = data;
  const [timestamp, sender, remoteJid, msgId] = filename.split("_");

  const classificationResult = await classify(
    text || data.debug.message,
    messageInfo.source || "whatsapp",
    sender
  );
  const resultToWrite = {
    ...messageInfo,
    ...classificationResult,
    link:
      messageInfo.source === "twitter"
        ? messageInfo.link
        : messageInfo.blobfilename,
    timestamp: +timestamp,
    filename,
    source: messageInfo.source || "whatsapp",
    senderId: sender,
  };

  fs.writeFileSync(
    `${POST_PATH}/${filename}.json`,
    JSON.stringify(resultToWrite, null, 4)
  );
  fs.unlinkSync(filepath);
});

console.log("Listening to messages....");
