const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "presets.json");

function readAll() {
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(presets) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(presets, null, 2));
}

function list() {
  return readAll();
}

function create(preset) {
  const presets = readAll();
  presets.push(preset);
  writeAll(presets);
  return preset;
}

function remove(id) {
  writeAll(readAll().filter((p) => p.id !== id));
}

module.exports = { list, create, remove };
