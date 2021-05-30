const sleep = require("util").promisify(setTimeout);
import { ComputerVisionClient } from "@azure/cognitiveservices-computervision";
import { BlobServiceClient } from "@azure/storage-blob";
import { ApiKeyCredentials } from "@azure/ms-rest-js";

/**
 * AUTHENTICATE
 * This single client is used for all examples.
 */
const key = "757442f2ea6a4b50860457555d9260c0";
const endpoint = "https://covidresourcesvision.cognitiveservices.azure.com/";
const AZURE_STORAGE_CONNECTION_STRING =
  "DefaultEndpointsProtocol=https;AccountName=covidresourcesstore;AccountKey=bsF2fyHV0xbf6Ie2CNULMCoqEc/AcX1P9hrEGU1VmXkrpH2kVpnDeBItxFtrIa/RRb7WJBEbUi67R9kRfKpigg==;EndpointSuffix=core.windows.net";

const computerVisionClient = new ComputerVisionClient(
  new ApiKeyCredentials({ inHeader: { "Ocp-Apim-Subscription-Key": key } }),
  endpoint
);

// Create the BlobServiceClient object which will be used to create a container client
const blobServiceClient = BlobServiceClient.fromConnectionString(
  AZURE_STORAGE_CONNECTION_STRING
);

// Status strings returned from Read API. NOTE: CASING IS SIGNIFICANT.
// Before Read 3.0, these are "Succeeded" and "Failed"
const STATUS_SUCCEEDED = "succeeded";
const STATUS_FAILED = "failed";

export default async function extractText(data, filename) {
  try {
    // Get a reference to a container
    const containerClient = blobServiceClient.getContainerClient("files");
    console.log("Filename:", filename);

    const blockBlobTxtClient = containerClient.getBlockBlobClient(
      filename + ".txt"
    );

    const extExists = await blockBlobTxtClient.exists();
    if (extExists) {
      const downloadBlockBlobResponse = await blockBlobTxtClient.download(0);
      console.log("Downloaded blob content...");
      const responseStr = await streamToString(
        downloadBlockBlobResponse.readableStreamBody
      );
      return responseStr;
    } else {
      const blockBlobJpegClient = containerClient.getBlockBlobClient(
        filename + ".jpeg"
      );

      const imageUrl = `https://covidresourcesstore.blob.core.windows.net/files/${
        filename + ".jpeg"
      }`;

      const uploadBlobResponse = await blockBlobJpegClient.upload(
        data,
        data.length
      );
      if (uploadBlobResponse.requestId) {
        console.log(`Blob was uploaded successfully. ${imageUrl}`);

        //Recognize text in printed image from a URL
        console.log("Read printed text from URL...", imageUrl.split("/").pop());
        const printedResult = await readTextFromURL(
          computerVisionClient,
          imageUrl
        );

        const extractedText = await printRecText(printedResult);
        await blockBlobTxtClient.upload(extractedText, extractText.length);
        return extractedText;
      }
    }
  } catch {}
  return "";
}

// Perform read and await the result from URL
async function readTextFromURL(client, url) {
  // To recognize text in a local image, replace client.read() with readTextInStream() as shown:
  let result = await client.read(url);
  // Operation ID is last path segment of operationLocation (a URL)
  let operation = result.operationLocation.split("/").slice(-1)[0];

  // Wait for read recognition to complete
  // result.status is initially undefined, since it's the result of read
  while (result.status !== STATUS_SUCCEEDED) {
    await sleep(500);
    result = await client.getReadResult(operation);
  }
  return result.analyzeResult.readResults; // Return the first page of result. Replace [0] with the desired page if this is a multi-page file such as .pdf or .tiff.
}

// Prints all text from Read result
function printRecText(readResults) {
  let str = "";
  for (const page in readResults) {
    const result = readResults[page];
    if (result.lines.length) {
      for (const line of result.lines) {
        const lineText = line.words.map((w) => w.text).join(" ");
        str += `\n${lineText}`;
      }
    } else {
      console.log("No recognized text.");
    }
  }
  return str;
}

// A helper function used to read a Node.js readable stream into a string
async function streamToString(readableStream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readableStream.on("data", (data) => {
      chunks.push(data.toString());
    });
    readableStream.on("end", () => {
      resolve(chunks.join(""));
    });
    readableStream.on("error", reject);
  });
}
