// Portable test runner (works on Node 18–22, Windows/macOS/Linux): npm test
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).map(f => path.join(__dirname, f));
process.exit(spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" }).status ?? 1);
