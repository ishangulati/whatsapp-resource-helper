import * as chokidar from "chokidar";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";

const watcher = chokidar.watch("./temp/Extracted", {
  ignored: /^\./,
  persistent: true,
});

const REPLY_PATH = "./temp/Reply";
!fs.existsSync(REPLY_PATH) && fs.mkdirSync(REPLY_PATH);

watcher.on("add", async function (filepath) {
  const filename = path.basename(filepath, ".json");
  const data = JSON.parse(fs.readFileSync(filepath).toString());

  const { date, debug, resources, ...metadata } = data;
  const dataToPost = {
    ...resources,
    ...metadata,
    filename,
    debug: JSON.stringify(debug),
  };

  if (data.type !== "None") {
    axios
      .post(
        "https://covidresourcesapi.azurewebsites.net/extractedcontact",
        dataToPost,
        { headers: { "secret-key": "password" } }
      )
      .then((res) => {
        console.log(`filename: ${filename}, statusCode: ${res.status}`);
        const folder = data.type === "requirement" ? "R" : "A";
        fs.writeFileSync(
          `${REPLY_PATH}/${folder}/${filename}.json`,
          JSON.stringify(data, null, 4)
        );
        // fs.writeFileSync(
        //   `./Reply/${folder}/REP_${filename}.json`,
        //   JSON.stringify(res.data, null, 4)
        // );
        fs.unlinkSync(filepath);
      })
      .catch((error) => {
        console.error(error);
        fs.writeFileSync(
          `./temp/Error/${filename}.json`,
          JSON.stringify(data, null, 4)
        );
        fs.unlinkSync(filepath);
      });
  } else {
    fs.writeFileSync(
      `${REPLY_PATH}/N/${filename}.json`,
      JSON.stringify(data, null, 4)
    );
    fs.unlinkSync(filepath);
  }
});

console.log("Listening to extracted folder...");
