import { NlpManager } from "node-nlp";
import data from "./resource-mapping";

const classifier = new NlpManager({
  languages: ["en"],
  threshold: 0.81,
  nlu: { useNoneFeature: false },
});

const CATEGORIES = [
  "medicine",
  "food",
  "ambulance",
  "oxygen",
  "bed",
  "therapy",
];

[
  "available on rent",
  "available",
  "free of cost",
  "sewa",
  "verified",
  "use and return",
  "refundable",
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
  // "IF YOU ARE IN NEED",
  "for patients only",
  "foundation",
  "if someone needs",
  "if anybody needs",
  // "anyone need this",
  // "helpline",
  // "all india",
  // "available for",
  // "available at",
  // "beds available",
  "pharma",
  "chemist available",
  "replacement basis", //blood donation
].forEach((value) => classifier.addDocument("en", value, "availability"));

[
  "need",
  "needs",
  "needed",
  "urgent",
  "urgently",
  "urgent need",
  "I need",
  "Urgently needed",
  "needed urgently",
  "have any leads",
  "any leads for",
  "any leads",
  "requirement",
  "requirements",
  "required",
  "require",
  "required for",
  "looking for",
  "attendant",
  "patient name",
  "please help",
  "SOS",
  "verified leads only",
  "i want",
  "blood needed",
  "kaha milega",
  "Pl inform",
  "need for rent",
  "has been prescribed",
  "if available",
  "can anyone help",
  "very urgent",
  // "hrct score",
  // "only verified leads",
  // "plasma needed",
  "my",
  "father",
  "mother",
  "cousin",
  "bother",
  "we need",
  "Patient is in",
  "patient name",
].forEach((value) => classifier.addDocument("en", value, "requirement"));

classifier.addDocument("en", "Beware", "none");

classifier.addRegexEntity(
  "bloodgroup",
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

export default async function classify(message, source, senderId) {
  await classifier.train();
  const length = message && message.length;
  const result = {
    debug: { message, length },
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
    .map((e) => normalizeContact(e.resolution.value))
    .filter(validateNormalizedNumber);

  const extractedContact = normalizeContact(fallbackContact(message));
  if (validateNormalizedNumber(extractedContact)) {
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
    resources["bloodgroup"] = classifications.entities
      .filter((e) => e.entity === "bloodgroup")
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

    if (
      resources["bloodgroup"].length === 0 ||
      message.indexOf("any blood group") > -1
    ) {
      resources["bloodgroup"].push("Any Group");
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

  result["location"] = [];

  data.cities.forEach((city) => {
    if (new RegExp(`\\b${city.toLowerCase()}\\b`).test(message)) {
      result["location"].push(city);
    }
  });

  console.log(result);
  return result;
}

function extractFields(data, fieldname) {
  const extRegex = new RegExp(`(?<=${fieldname})(\\s*:*\\s*)(.*)\\n`, "gim");
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
  if (
    normalizedContact.startsWith("1") &&
    // numbers like 100, 1075, 1800 209 2359
    ((normalizeContact.length >= 3 && normalizeContact.length < 6) ||
      normalizeContact.length === 11)
  ) {
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

function validateNormalizedNumber(phoneNumber) {
  if (
    phoneNumber.startsWith("1") &&
    // numbers like 100, 1075, 1800 209 2359
    ((phoneNumber.length >= 3 && phoneNumber.length < 6) ||
      phoneNumber.length === 11)
  ) {
    return true;
  } else {
    // along with +91
    return phoneNumber.length === 13;
  }
}
