// Require express and body-parser
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
// Initialize express and define a portconst 
app = express();
const PORT = 3000;
// for parsing application/json
app.use(bodyParser.json()); 
// for parsing application/xwww-
app.use(bodyParser.urlencoded({ extended: true })); //form-urlencoded
app.post("/extracted-hook", (req, res) => {    
    console.log(req.body);
    const {filename, ...text} = req.body; 
    fs.writeFileSync(`./Extracted/${filename.substr(0, filename.lastIndexOf(".")) + ".json"}`, JSON.stringify(text, null, 4));
    // Call your action on the request here
    res.status(200).end(); 
    // Responding is important
});
// Start express on the defined port
app.listen(PORT, () => console.log(`  Server running on port ${PORT}`));