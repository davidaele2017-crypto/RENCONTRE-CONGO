// Petite base de données "fichier JSON" — volontairement simple, pas de serveur
// de base de données à installer. Suffisant pour un prototype / petite communauté.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// En production, pointe DATA_DIR vers un disque persistant (ex: le "Persistent
// Disk" de Render) — sinon les données sont perdues à chaque redéploiement,
// car le système de fichiers d'un hébergeur classique est éphémère.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_FILE = path.join(DATA_DIR, 'data.json');

function defaultData() {
  return { users: [], profiles: [], likes: [], passes: [], matches: [], messages: [], orders: [] };
}

function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData(), null, 2));
  }
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    data = defaultData();
  }
  // Complète les tableaux manquants pour rester compatible avec un data.json
  // créé par une version plus ancienne du code.
  return Object.assign(defaultData(), data);
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function id() {
  return crypto.randomUUID();
}

module.exports = { load, save, id };
