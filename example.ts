import {
  WAConnection,
  MessageType,
  ReconnectMode,
  waChatKey,
  WAChat,
  WAMessage,
  WAChatUpdate,
} from "@adiwajshing/baileys";
import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";

const CONTACT_REXGEX = /(\+\d{1,2})?(\s+)?((\s)?\d(\s)?){10,11}/g;
const MEDIA_PATH = "./Media";

async function example() {
  !fs.existsSync(MEDIA_PATH) && fs.mkdirSync(MEDIA_PATH);
  !fs.existsSync("./Extracted") && fs.mkdirSync("./Extracted");
  !fs.existsSync("./Done") && fs.mkdirSync("./Done");
  const lastEpocString =
    fs.existsSync("./last_process.time") &&
    fs.readFileSync("./last_process.time");
  let lastEpocTime: number = +(lastEpocString || 0);
  console.warn("Global Epoc: " + lastEpocTime);

  const conn = new WAConnection(); // instantiate
  conn.autoReconnect = ReconnectMode.onConnectionLost; // only automatically reconnect when the connection breaks
  conn.logger.level = "warn"; // set to 'debug' to see what kind of stuff you can implement
  // attempt to reconnect at most 10 times in a row
  conn.connectOptions.maxRetries = 100;
  conn.chatOrderingKey = waChatKey(true); // order chats such that pinned chats are on top

  conn.on("initial-data-received", async () => {
    console.log("received all initial messages");
    const pendingMsgs = extractPendingMessages();
    console.warn("Pending Messages Count: " + pendingMsgs.length);

    for (const message of pendingMsgs) {
      await processMessage(message);
    }

    conn.on("chat-update", newMessageListener);
    const watcher = chokidar.watch("./Extracted", {
      ignored: /^\./,
      persistent: true,
    });

    watcher.on("add", async function (filepath) {
      const filename = path.basename(filepath, ".json");
      const [sender, remoteJid, msgId] = filename.split("_");
      console.log("Replying with extracted data: " + filename);

      const m = await conn.loadMessage(remoteJid, msgId);
      const data = fs.readFileSync(filepath).toString();
      if (data) {
        await conn.sendMessage(remoteJid, data, MessageType.extendedText, {
          quoted: m,
        });
      } else {
        console.warn("No extracted info: " + filepath);
      }
      fs.renameSync(filepath, `./Done/${filename}`);
    });

    conn.on("close", ({ reason, isReconnecting }) => {
      console.log(
        "oh no got disconnected: " +
          reason +
          ", reconnecting: " +
          isReconnecting
      );
      watcher.removeAllListeners();
      conn.removeAllListeners("chat-update");
    });
  });

  // loads the auth file credentials if present
  /*  Note: one can take this auth_info.json file and login again from any computer without having to scan the QR code, 
        and get full access to one's WhatsApp. Despite the convenience, be careful with this file */
  fs.existsSync("./auth_info.json") && conn.loadAuthInfo("./auth_info.json");
  // uncomment the following line to proxy the connection; some random proxy I got off of: https://proxyscrape.com/free-proxy-list
  //conn.connectOptions.agent = ProxyAgent ('http://1.0.180.120:8080')
  await conn.connect();
  // credentials are updated on every connect
  const authInfo = conn.base64EncodedAuthInfo(); // get all the auth info we need to restore this session
  fs.writeFileSync("./auth_info.json", JSON.stringify(authInfo, null, "\t")); // save this info to a file
  console.log("oh hello " + conn.user.name + " (" + conn.user.jid + ")");

  /* example of custom functionality for tracking battery */
  conn.on("CB:action,,battery", (json) => {
    const batteryLevelStr = json[2][0][1].value;
    const batterylevel = parseInt(batteryLevelStr);
    console.log("battery level: " + batterylevel);
  });

  function extractPendingMessages(): WAMessage[] {
    const pendingMsgs: WAMessage[] = [];
    const c = conn.chats.all().filter((m: WAChat) => +m.t > lastEpocTime);

    for (let i = 0; i < c.length; i++) {
      const m = c[i].messages.filter(
        (m) =>
          m.messageTimestamp > lastEpocTime &&
          m.messageStubType !== 1 &&
          m.key.fromMe === false
      );
      pendingMsgs.push(...m.all());
    }

    return pendingMsgs.sort(
      (a, b) => +a.messageTimestamp - +b.messageTimestamp
    );
  }

  async function processMessage(m: WAMessage) {
    const messageContent = m.message;
    // if it is not a regular text or media message
    if (!messageContent) return;

    if (m.key.fromMe) {
      return;
    }

    const chatId = m.key.remoteJid;
    let sender = m.key.remoteJid;
    if (m.participant) {
      // participant exists if the message is in a group
      sender = m.participant;
    }

    const filename = `${MEDIA_PATH}/${sender}_${chatId}_${m.key.id}`;
    const messageType = Object.keys(messageContent)[0]; // message will always contain one key signifying what kind of message
    if (messageType === MessageType.text) {
      const text = m.message.conversation;
      if (CONTACT_REXGEX.test(text)) {
        fs.writeFileSync(`${filename}.txt`, text);
        console.log(sender + " sent text, saved at: " + filename);
      } else {
        console.warn(
          "Text doesn't contain contact hence ignoring: " + filename
        );
      }
    } else if (messageType === MessageType.extendedText) {
      const text = m.message.extendedTextMessage.text;
      if (CONTACT_REXGEX.test(text)) {
        fs.writeFileSync(`${filename}.txt`, text);
        console.log(sender + " sent text, saved at: " + filename);
      } else {
        console.warn(
          "Text doesn't contain contact hence ignoring: " + filename
        );
      }
    } else if (messageType === MessageType.image) {
      // decode, decrypt & save the media.
      // The extension to the is applied automatically based on the media type
      try {
        const savedFile = await conn.downloadAndSaveMediaMessage(m, filename);
        console.log(sender + " sent media, saved at: " + filename);
      } catch (err) {
        console.log("error in decoding message: " + err);
      }
    }

    if (+m.messageTimestamp > lastEpocTime) {
      lastEpocTime = +m.messageTimestamp;
      fs.writeFileSync("./last_process.time", lastEpocTime.toString());
    }
  }

  async function newMessageListener(chat: WAChatUpdate) {
    if (chat.presences) {
      // receive presence updates -- composing, available, etc.
      Object.values(chat.presences).forEach((presence) =>
        console.log(
          `${presence.name}'s presence is ${presence.lastKnownPresence} in ${chat.jid}`
        )
      );
    }

    // only do something when a new message is received
    if (chat.imgUrl || !chat.hasNewMessage) {
      return;
    }

    const m = chat.messages.all()[0]; // pull the new message from the update
    await processMessage(m);
  }
}

example().catch((err) => console.log(`encountered error: ${err}`));
