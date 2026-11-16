// Builds demo/WarrantyChain-demo.html: one file with the website + the fake blockchain,
// so it can be shared online without MetaMask. Run: npm run build-demo
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const html = read("frontend/index.html");
const title = html.match(/<title>.*<\/title>/)[0];
let body = html.match(/<body>([\s\S]*)<\/body>/)[1];

// Put the files inside the page (a function is used so "$" in the code is not treated specially)
body = body.replace('<script src="contract-config.js"></script>', () => "<script>\n" + read("demo/demo-chain.js") + "\n</script>");
body = body.replace('<script src="app.js"></script>', () => "<script>\n" + read("frontend/app.js") + "\n</script>");

const style = "<style>\n" + read("frontend/style.css") + "\n</style>\n";
const output = title + "\n" + style + body;
fs.writeFileSync(path.join(root, "demo", "WarrantyChain-demo.html"), output);
console.log("Built demo/WarrantyChain-demo.html");

// Same demo as a normal web page for hosting sites like Netlify (they need a file called index.html)
const fullPage =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  title + "\n" + style +
  "</head>\n<body>" + body + "</body>\n</html>\n";
fs.mkdirSync(path.join(root, "demo", "website"), { recursive: true });
fs.writeFileSync(path.join(root, "demo", "website", "index.html"), fullPage);
console.log("Built demo/website/index.html (drag the demo/website folder to Netlify)");
