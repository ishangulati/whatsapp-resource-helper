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
import extractText from "./readImageData";
import * as path from "path";
import {
  ExtractedContact,
  IExtractedArrays,
  IListingContact,
} from "./types/Models";
import axios from "axios";

const MEDIA_PATH = "./temp/Messages";
// const WHITELIST_CHATS = [
//   "918882862622-1620221666@g.us", //'Pranada- Covid help'
//   "918368724288-1619193519@g.us", //'Khwaish Team😎💥'
//   "919811120453-1619274698@g.us", //'Let's save India!'
//   "919468345974-1619170723@g.us", //'COVID DELHI HELP'
//   "918882017923-1621625789@g.us", //Testing
// ];

async function waListener() {
  !fs.existsSync(MEDIA_PATH) && fs.mkdirSync(MEDIA_PATH);
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
    const pendingMsgs = await extractPendingMessages();
    console.warn("Pending Messages Count: " + pendingMsgs.length);

    for (const message of pendingMsgs) {
      await processMessage(message);
    }

    conn.on("chat-update", newMessageListener);
    const watcher = chokidar.watch("./temp/Reply/R", {
      ignored: /^\./,
      persistent: true,
    });

    watcher.on("add", async function (filepath) {
      const filename = path.basename(filepath, ".json");
      const [_, sender, remoteJid, msgId] = filename.split("_");

      const SAFETOREPLY =
        remoteJid === "918882017923-1621625789@g.us" ||
        sender === "918447559779@s.whatsapp.net" ||
        sender === "919872825242@s.whatsapp.net";

      console.log("Replying with extracted data: " + filename);
      if (SAFETOREPLY) {
        conn.chatRead(remoteJid);
        const m = await conn.loadMessage(remoteJid, msgId);

        const data: ExtractedContact = JSON.parse(
          fs.readFileSync(filepath).toString()
        );

        const replyText = await getReplyText(data);
        if (replyText) {
          await conn.sendMessage(
            // "918882017923-1621625789@g.us",
            // `_Original text:_\n_${
            //   JSON.parse(data.debug).message
            // }_\nReply:\n\n\n${replyText}`,
            //MessageType.text
            remoteJid,
            replyText,
            MessageType.extendedText,
            {
              quoted: m,
            }
          );
        }
      } else {
        console.warn("No extracted info: " + filepath);
      }

      fs.renameSync(filepath, `./temp/Done/${filename}.json`);
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

  async function extractPendingMessages(): Promise<WAMessage[]> {
    let pendingMsgs: WAMessage[] = [];
    const c = conn.chats
      .all()
      .filter(
        (ch: WAChat) =>
          +ch.t > lastEpocTime 
          // &&
          // (WHITELIST_CHATS.length === 0 || WHITELIST_CHATS.indexOf(ch.jid) > -1)
      );

    for (let i = 0; i < c.length; i++) {
      const messageResp = await conn.loadMessages(
        c[i].jid,
        2000,
        { fromMe: false },
        true
      );
      // if start is too late in array
      const startIndex = bs2(
        messageResp.messages,
        0,
        messageResp.messages.length - 1,
        lastEpocTime
      );

      const messages = messageResp.messages.slice(startIndex);

      const m = messages.filter(
        (m) =>
          m.messageTimestamp > lastEpocTime &&
          m.messageStubType !== 1 &&
          m.key.fromMe === false
      );
      pendingMsgs = pendingMsgs.concat(m);
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

    // if (WHITELIST_CHATS.length && WHITELIST_CHATS.indexOf(chatId) === -1) {
    //   updateTimeStamp(m.messageTimestamp);
    //   return;
    // }

    const filename = `${sender}_${chatId}_${m.key.id}.json`;
    const timestamp = m.messageTimestamp.toString();

    console.log("Processing:", timestamp, filename);
    const messageType = Object.keys(messageContent)[0]; // message will always contain one key signifying what kind of message

    const MESSAGE_FILEPATH = `${MEDIA_PATH}/${timestamp}_${filename}`;
    if (fs.existsSync(MESSAGE_FILEPATH)) {
      updateTimeStamp(m.messageTimestamp);
      return;
    }

    let text = "";
    let blobfilename = "";

    if (
      messageType === MessageType.text ||
      messageType === MessageType.extendedText
    ) {
      text = m.message.conversation || m.message.extendedTextMessage.text;
    } else if (messageType === MessageType.image) {
      // decode, decrypt & save the media.
      // The extension to the is applied automatically based on the media type
      text = m.message.imageMessage.caption || "";
      try {
        const buffer = await conn.downloadMediaMessage(m);
        blobfilename =
          bufferToBase64(m.message.imageMessage.fileSha256) || filename;
        text += "\n" + (await extractText(buffer, blobfilename));
      } catch (err) {
        console.log("error in extracting media message: " + err);
      }
    } else {
      updateTimeStamp(m.messageTimestamp);
      return;
    }

    if (text.length < 25) {
      updateTimeStamp(m.messageTimestamp);
      return;
    }

    fs.writeFileSync(
      MESSAGE_FILEPATH,
      JSON.stringify(
        {
          source: "whatsapp",
          text,
          senderId: sender,
          blobfilename,
          timestamp,
          date: new Date(+timestamp * 1000),
        },
        null,
        4
      )
    );
    updateTimeStamp(m.messageTimestamp);
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

  function updateTimeStamp(messageTimestamp) {
    if (+messageTimestamp > lastEpocTime) {
      lastEpocTime = +messageTimestamp;
      fs.writeFileSync("./last_process.time", lastEpocTime.toString());
    }
  }
}

function bufferToBase64(buffer) {
  if (buffer) return Base64EncodeUrl(buffer.toString("base64"));
  return "";
}

function Base64EncodeUrl(str) {
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/\=+$/, "");
}

function Base64DecodeUrl(str) {
  str = (str + "===").slice(0, str.length + (str.length % 4));
  return str.replace(/-/g, "+").replace(/_/g, "/");
}

function bs2(array, left, right, elem) {
  if (left >= right) return left;

  let middle = 0;
  middle = Math.floor((left + right) / 2);
  if (elem > array[middle].messageTimestamp)
    return bs2(array, middle + 1, right, elem);
  if (elem < array[middle].messageTimestamp)
    return bs2(array, left, middle, elem); //<--- was: middle-1
  return middle; // element existed into array
}

waListener().catch((err) => console.log(`encountered error: ${err}`));

async function getReplyText(extractedData: any): Promise<string> {
  const categoryDetails = getResourceCategory(extractedData.resources);
  if (categoryDetails) {
    const params = new URLSearchParams();

    categoryDetails.options.forEach((opt) =>
      params.append(categoryDetails.category, opt)
    );
    params.append("type", "availability");
    const apiUrl = `https://covidresourcesapi.azurewebsites.net/contacts?count=5&${params.toString()}`;

    const subCategories = categoryDetails.options.join(", ");
    const categoryText =
      categoryDetails.category === "bloodgroup"
        ? `Blood (${subCategories})`
        : subCategories;

    return axios
      .get(apiUrl)
      .then((response) => {
        const contacts = response.data as IListingContact[];
        if (contacts && contacts.length) {
          return (
            `_Are you looking for ${categoryText}?_\n` +
            "Here are some latest shared contacts in groups that might help:\n" +
            `\n${contacts
              .map(
                (contact) =>
                  `*${contact.contactuid}* (${timeDifference(
                    new Date().getTime(),
                    new Date(contact.lastShared).getTime()
                  )})`
              )
              .join("\n")}\n` +
            `\nFor more help go to: https://ishangulati.github.io/covid-resources-portal/#/search?${params.toString()}`
          );
        }
        return (
          `_Are you looking for ${categoryText}?_\n` +
          `\nKeep checking our portal for updates: https://ishangulati.github.io/covid-resources-portal/#/search?${params.toString()}`
        );
      })
      .catch(
        () =>
          `_Are you looking for ${categoryText}?_\n` +
          `\nKeep checking our portal for updates: https://ishangulati.github.io/covid-resources-portal/#/search?${params.toString()}`
      );
  } else {
    return null;
  }
}

function getResourceCategory(extractedData: IExtractedArrays): {
  category: string;
  options: string[];
} {
  for (const category of CATEGORIES) {
    if (extractedData[category] && extractedData[category].length > 0) {
      return { category, options: extractedData[category] };
    }
  }
  return null;
}

export const CATEGORIES = [
  "medicine",
  "bloodgroup",
  "therapy",
  "oxygen",
  "bed",
  "ambulance",
  "food",
];

function timeDifference(current: number, previous: number) {
  var msPerMinute = 60 * 1000;
  var msPerHour = msPerMinute * 60;
  var msPerDay = msPerHour * 24;
  var msPerMonth = msPerDay * 30;
  var msPerYear = msPerDay * 365;

  var elapsed = current - previous;

  if (elapsed < msPerMinute) {
    return Math.round(elapsed / 1000) + " seconds ago";
  } else if (elapsed < msPerHour) {
    return Math.round(elapsed / msPerMinute) + " minutes ago";
  } else if (elapsed < msPerDay) {
    return Math.round(elapsed / msPerHour) + " hours ago";
  } else if (elapsed < msPerMonth) {
    return Math.round(elapsed / msPerDay) + " days ago";
  } else if (elapsed < msPerYear) {
    return Math.round(elapsed / msPerMonth) + " months ago";
  } else {
    return Math.round(elapsed / msPerYear) + " years ago";
  }
}
