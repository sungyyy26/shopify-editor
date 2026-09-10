const fs = require("fs");
const path = require("path");

// dotenv 없이 .env 파일을 process.env로 로드
function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  // Windows 메모장은 새 파일을 UTF-8 BOM으로 저장하는 경우가 많아 제거
  let content = fs.readFileSync(envPath, "utf8");
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

// .env 파일에 key=value를 추가하거나 기존 값을 교체하고 process.env도 갱신
function setEnvValue(key, value) {
  const envPath = path.join(__dirname, "..", ".env");
  const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const lines = existing.split("\n").filter((l) => l.trim() !== "");
  const idx = lines.findIndex((l) => l.startsWith(key + "="));
  const line = `${key}=${value}`;
  if (idx === -1) lines.push(line);
  else lines[idx] = line;
  fs.writeFileSync(envPath, lines.join("\n") + "\n");
  process.env[key] = value;
}

module.exports = { loadEnv, setEnvValue };
