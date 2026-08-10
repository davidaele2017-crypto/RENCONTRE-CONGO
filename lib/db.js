// Connexion PostgreSQL — remplace l'ancien stockage "fichier data.json".
// Un vrai SGBD gère correctement les accès simultanés (plusieurs personnes
// qui likent/matchent/discutent en même temps), ce qu'un fichier JSON ne
// pouvait pas garantir (risque de corruption/perte de données sous charge).
const { Pool } = require('pg');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL manquant. Renseigne-le dans .env (base PostgreSQL — voir .env.example)."
  );
}

// Render (et la plupart des hébergeurs Postgres managés) exige TLS pour les
// connexions externes ; `rejectUnauthorized: false` évite d'avoir à gérer un
// certificat CA côté client — acceptable ici car la chaîne de connexion
// elle-même (avec mot de passe) est déjà le secret qui protège l'accès.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function id() {
  return crypto.randomUUID();
}

// Crée les tables si elles n'existent pas encore — suffisant à cette échelle,
// pas besoin d'un outil de migration séparé pour un schéma qui évolue peu.
async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      phone TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'gratuit',
      likes_today INTEGER NOT NULL DEFAULT 0,
      likes_reset_date TEXT,
      phone_verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Ajoute la colonne si la table existait déjà avant cette version (mise
    -- à jour d'une base existante sans tout recréer).
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS profiles (
      user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      age INTEGER,
      gender TEXT,
      looking_for TEXT,
      pays TEXT,
      ville TEXT,
      langues TEXT[] NOT NULL DEFAULT '{}',
      bio TEXT,
      photo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS likes (
      id UUID PRIMARY KEY,
      from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(from_user_id, to_user_id)
    );

    CREATE TABLE IF NOT EXISTS passes (
      id UUID PRIMARY KEY,
      from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(from_user_id, to_user_id)
    );

    -- user_a_id/user_b_id sont toujours stockés triés (le plus petit UUID en
    -- premier) pour que la contrainte UNIQUE empêche un match en double,
    -- peu importe qui a liké qui en premier.
    CREATE TABLE IF NOT EXISTS matches (
      id UUID PRIMARY KEY,
      user_a_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_b_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(user_a_id, user_b_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY,
      match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id UUID PRIMARY KEY,
      transaction_id TEXT UNIQUE NOT NULL,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_likes_from ON likes(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_likes_to ON likes(to_user_id);
    CREATE INDEX IF NOT EXISTS idx_passes_from ON passes(from_user_id);
    CREATE INDEX IF NOT EXISTS idx_matches_a ON matches(user_a_id);
    CREATE INDEX IF NOT EXISTS idx_matches_b ON matches(user_b_id);
    CREATE INDEX IF NOT EXISTS idx_messages_match ON messages(match_id);
  `);
}

module.exports = { pool, id, initSchema };
