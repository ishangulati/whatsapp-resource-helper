import { NlpManager } from "node-nlp";
import data from "./resource-mapping";

const classifier = new NlpManager({
  languages: ["en"],
  threshold: 0.81,
  nlu: { useNoneFeature: false },
});

const locationExtractor = new NlpManager({
  languages: ["en"],
  threshold: 0.81,
  nlu: { useNoneFeature: false },
});

const CATEGORIES = [
  "medicine",
  "food",
  "ambulance",
  "oxygen",
  "beds",
  "therapy",
];

[
  "on rent",
  "available",
  "free",
  "sewa",
  "verified",
  "avl",
  "patient should",
  "dm for covid help",
  "sellers",
  "deals",
  "IndiaMart",
  "they have vacant beds",
  "if anyone needs",
  "database",
  "supply",
  "Distributor",
  "sold",
  "They are providing",
  "Personally verified",
  "Hope it helps",
  "IF YOU ARE IN NEED",
  "for patients only",
  "foundation",
].forEach((value) => classifier.addDocument("en", value, "available"));

[
  "required",
  "needed",
  "urgent",
  "urgently",
  "have any leads",
  "any leads for",
  "requirement",
  "requirements",
  "looking for",
  "attendant",
  "patient name",
  "need",
  "needs",
  "help",
  "require",
  "required for",
  "SOS",
  "please",
  "verified leads only",
  "i want",
  "blood needed",
  "kaha milega",
  "urgent need",
  "Pl inform",
  "need for rent",
  "has been prescribed",
  "if available",
  "can anyone help",
].forEach((value) => classifier.addDocument("en", value, "requirement"));

classifier.addDocument("en", "Beware", "none");

classifier.addRegexEntity(
  "blood",
  "en",
  /(\b)?(A|B|AB|O)(\s)?(\+ve\b|\-ve\b|-\B|\+\B|pos|neg)/gim
);

for (const categoryKey of CATEGORIES) {
  for (const resourceKey in data[categoryKey]) {
    classifier.addNamedEntityText(
      categoryKey,
      resourceKey,
      ["en"],
      data[categoryKey][resourceKey]
    );
  }
}

data.cities.forEach((value) =>
  locationExtractor.addNamedEntityText("location", value, "en", [value])
);

export default async function classify(
  message,
  source,
  senderId,
  addtionalInfo
) {
  await classifier.train();
  const length = message && message.length;
  const result = {
    debug: { message, length, ...addtionalInfo },
    type: "None",
  };

  if (length > 1000) {
    return result;
  }

  message = message.replace(/#/gi, " ").toLowerCase();
  const classifications = await classifier.process("en", message);
  result["type"] =
    classifications.score > 0.55 ? classifications.intent : "None";
  result["debug"]["typescore"] = classifications.score;

  let contacts = classifications.entities
    .filter((e) => e.entity === "phonenumber")
    .map((e) => normalizeContact(e.resolution.value));

  const extractedContact = normalizeContact(fallbackContact(message));
  if (extractedContact !== "+91" && extractedContact !== "") {
    contacts.push(extractedContact);
  }

  contacts = contacts.filter(onlyUnique);

  //If no contact and personalized message
  if (contacts.length === 0) {
    for (const word of data.senderkeywords) {
      if (message.indexOf(word.toLowerCase()) > -1) {
        contacts.push(getSenderContact(senderId));
        result["debug"]["senderContact"] = true;
        break;
      }
    }
  }

  result["contact"] = contacts;

  const resources = {};
  CATEGORIES.forEach((ck) => {
    const rs = classifications.entities
      .filter((e) => e.entity === ck && e.accuracy > 0.8)
      .map((e) => e.option)
      .filter(onlyUnique);

    if (rs.length) {
      resources[ck] = rs;
    }
  });

  let extractBloodGroup = false;
  for (const word of data.bloodkeywords) {
    if (message.indexOf(word.toLowerCase()) > -1) {
      extractBloodGroup = true;
      break;
    }
  }
  if (extractBloodGroup) {
    resources["blood"] = classifications.entities
      .filter((e) => e.entity === "blood")
      .map((e) =>
        e.sourceText
          .replace(/\s/g, "")
          // for handle AB cases change 'A+' & 'A+ve' to 'A+ '
          .replace(/pos/gi, "+ ")
          .replace(/neg/gi, "- ")
          .replace(/ve/gi, " ")
          .substr(0, 3)
          .trim()
          .toUpperCase()
      )
      .filter(onlyUnique)
      .sort();
    if (resources["blood"].length === 0) {
      resources["blood"] = ["Any Group"];
    }
  }

  result["resources"] = resources;
  result["name"] = extractFields(message, "name");
  result["verified"] = extractFields(message, "verified");

  // no resources identified
  if (Object.keys(resources).length === 0 || contacts.length === 0) {
    result["debug"]["prevtype"] = result["type"];
    result["type"] = "None";
    result["debug"]["typescore"] = 1;
  }

  // Do it only when have to since its time consuming
  if (result["type"] !== "None") {
    await locationExtractor.train();
    const locationsClasses = await classifier.process("en", message);
    result["location"] = locationsClasses.entities
      .filter((e) => e.entity === "location" && e.accuracy > 0.8)
      .map((c) => c.option)
      .filter(onlyUnique);
  }
  console.log(result);
  return result;
}

function extractFields(data, fieldname) {
  const extRegex = new RegExp(`(?<=${fieldname})(\s*:*\s*)(.*)\n`, "gim");
  const matches = extRegex.exec(data);
  if (matches && matches.length > 2) {
    return matches[2];
  }
  return "";
}

function fallbackContact(data) {
  const contactRegex = /(\+\d{1,2})?(\s+-+)?((\s)?\d(\s+\n+)?){10,11}/gm;
  const matches = contactRegex.exec(data);
  if (matches) {
    return matches[0];
  }
  return "";
}

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

function normalizeContact(phoneNumber) {
  let normalizedContact = phoneNumber.replace(/[^0-9.]/g, "");
  // helpline number
  if (normalizedContact[0] === "1") {
    //do nothing
  } else {
    const number = normalizedContact.substr(-10);
    if (number) normalizedContact = "+91" + number;
  }

  return normalizedContact;
}

function getSenderContact(senderId) {
  return "+" + senderId.split("@")[0];
}
