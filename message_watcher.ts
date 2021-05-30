import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import classify from "./classifier";

const watcher = chokidar.watch("./Media/Messages", {
  ignored: /^\./,
  persistent: true,
});

watcher.on("add", async function (filepath) {
  const filename = path.basename(filepath, ".json");
  const data = JSON.parse(fs.readFileSync(filepath).toString());
  const { text, ...messageInfo } = data;
  const [timestamp, sender, remoteJid, msgId] = filename.split("_");

  const classificationResult = await classify(
    text || data.debug.message,
    messageInfo.source || "whatsapp",
    messageInfo.senderId || sender
  );
  const resultToWrite = { ...messageInfo, ...classificationResult };

  fs.writeFileSync(
    `./Extracted/${filename}.json`,
    JSON.stringify(resultToWrite, null, 4)
  );
  fs.unlinkSync(filepath);
});
