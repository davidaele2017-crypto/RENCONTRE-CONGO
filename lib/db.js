// Petite base de données "fichier JSON" — volontairement simple, pas de serveur
// de base de données à installer. Suffisant pour un prototype / petite communauté.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', 'data.json');

function defaultData() {
  return { users: [], profiles: [], likes: [], passes: [], matches: [], messages: [] };
}

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData(), null, 2));
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    return defaultData();
  }
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function id() {
  return crypto.randomUUID();
}

module.exports = { load, save, id };
