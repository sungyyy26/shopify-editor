const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "jobs.json");
const MAX_JOBS = 100; // 오래된 작업은 정리해 파일이 무한정 커지지 않도록 함

function readAll() {
  if (!fs.existsSync(FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(jobs) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2));
}

function list() {
  return readAll().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(id) {
  return readAll().find((j) => j.id === id) || null;
}

function create(job) {
  const jobs = readAll();
  jobs.push(job);
  writeAll(jobs.slice(-MAX_JOBS));
  return job;
}

function update(id, patch) {
  const jobs = readAll();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx === -1) return null;
  jobs[idx] = { ...jobs[idx], ...patch };
  writeAll(jobs);
  return jobs[idx];
}

function remove(id) {
  writeAll(readAll().filter((j) => j.id !== id));
}

function removeAll() {
  writeAll([]);
}

module.exports = { list, get, create, update, remove, removeAll };
