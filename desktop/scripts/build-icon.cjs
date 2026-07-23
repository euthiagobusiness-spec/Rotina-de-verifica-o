const fs = require("node:fs");
const path = require("node:path");
const { default: pngToIco } = require("png-to-ico");

async function buildIcon() {
  const source = path.join(__dirname, "..", "assets", "icon.png");
  const target = path.join(__dirname, "..", "assets", "icon.ico");
  const icon = await pngToIco(source);
  fs.writeFileSync(target, icon);
}

buildIcon().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
