// Fonctions "métier" — interrogent directement PostgreSQL (voir lib/db.js).
// Chaque fonction qui touche à la base est async et effectue ses propres
// requêtes ciblées, au lieu de charger/sauvegarder un gros blob à chaque fois
// (l'ancienne approche "fichier JSON").
const { pool, id } = require('./db');
const { PLANS, getUserPlan } = require('./plans');

const LANGUES = ['Lingala', 'Swahili', 'Kikongo', 'Tshiluba', 'Français', 'Anglais'];
const VILLES = {
  'RDC': ['Kinshasa', 'Lubumbashi', 'Mbuji-Mayi', 'Kananga', 'Kisangani', 'Bukavu', 'Goma', 'Kolwezi', 'Likasi', 'Matadi', 'Uvira', 'Butembo'],
  'Congo-Brazzaville': ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Owando', 'Ouesso', 'Impfondo']
};

const COUNTRY_CODES = { 'RDC': '243', 'Congo-Brazzaville': '242' };

// Les 24 communes de Kinshasa — pratique pour l'autocomplétion (datalist),
// mais le champ "commune" reste un texte libre (pour Lubumbashi, les
// arrondissements de Brazzaville, etc., pas de liste exhaustive maintenue ici).
const COMMUNES_KINSHASA = [
  'Bandalungwa', 'Barumbu', 'Bumbu', 'Gombe', 'Kalamu', 'Kasa-Vubu', 'Kimbanseke',
  'Kinshasa', 'Kintambo', 'Kisenso', 'Lemba', 'Limete', 'Lingwala', 'Makala',
  'Maluku', 'Masina', 'Matete', 'Mont-Ngafula', 'Ndjili', 'Ngaba', 'Ngaliema',
  'Ngiri-Ngiri', 'N\'sele', 'Selembao'
];

// --- Correspondance colonnes SQL (snake_case) <-> objets JS (camelCase) ---
// Garde le reste du code (server.js, les vues EJS) inchangé malgré la
// migration : seuls db.js et store.js savent que la base est PostgreSQL.
function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    passwordHash: row.password_hash,
    plan: row.plan,
    likesToday: row.likes_today,
    likesResetDate: row.likes_reset_date,
    phoneVerifiedAt: row.phone_verified_at,
    createdAt: row.created_at
  };
}

function mapProfile(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    name: row.name,
    age: row.age,
    gender: row.gender,
    lookingFor: row.looking_for,
    pays: row.pays,
    ville: row.ville,
    commune: row.commune,
    langues: row.langues || [],
    bio: row.bio,
    photo: row.photo,
    createdAt: row.created_at
  };
}

function mapMatch(row) {
  if (!row) return null;
  return { id: row.id, userAId: row.user_a_id, userBId: row.user_b_id, createdAt: row.created_at };
}

function mapMessage(row) {
  if (!row) return null;
  return { id: row.id, matchId: row.match_id, fromUserId: row.from_user_id, text: row.text, createdAt: row.created_at };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id, transactionId: row.transaction_id, userId: row.user_id, planId: row.plan_id,
    amount: row.amount, currency: row.currency, status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

// Transforme un numéro saisi localement (ex: "0812345678" ou "812 34 56 78")
// en format international stable (ex: "+243812345678") pour servir d'identifiant unique.
function normalizePhone(rawPhone, pays) {
  const code = COUNTRY_CODES[pays] || COUNTRY_CODES['RDC'];
  let digits = String(rawPhone || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, ''); // retire le 0 initial (format local)
  if (digits.startsWith(code)) digits = digits.slice(code.length); // évite le double préfixe
  return `+${code}${digits}`;
}

async function getUserByPhone(phone) {
  const res = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
  return mapUser(res.rows[0]);
}

async function getUserById(userId) {
  if (!userId) return null;
  const res = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
  return mapUser(res.rows[0]);
}

// N'est appelée qu'après vérification réussie du code SMS (voir server.js,
// route /verify-phone) — phone_verified_at est donc toujours renseigné dès
// la création du compte.
async function createUser({ phone, passwordHash }) {
  const res = await pool.query(
    `INSERT INTO users (id, phone, password_hash, phone_verified_at) VALUES ($1, $2, $3, now()) RETURNING *`,
    [id(), phone, passwordHash]
  );
  return mapUser(res.rows[0]);
}

async function getProfile(userId) {
  if (!userId) return null;
  const res = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  return mapProfile(res.rows[0]);
}

function profileComplete(profile) {
  return !!(profile && profile.name && profile.age && profile.gender && profile.lookingFor && profile.ville);
}

async function upsertProfile(userId, fields) {
  const res = await pool.query(
    `INSERT INTO profiles (user_id, name, age, gender, looking_for, pays, ville, commune, langues, bio, photo)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, profiles.name),
       age = COALESCE(EXCLUDED.age, profiles.age),
       gender = COALESCE(EXCLUDED.gender, profiles.gender),
       looking_for = COALESCE(EXCLUDED.looking_for, profiles.looking_for),
       pays = COALESCE(EXCLUDED.pays, profiles.pays),
       ville = COALESCE(EXCLUDED.ville, profiles.ville),
       commune = COALESCE(EXCLUDED.commune, profiles.commune),
       langues = COALESCE(EXCLUDED.langues, profiles.langues),
       bio = COALESCE(EXCLUDED.bio, profiles.bio),
       photo = COALESCE(EXCLUDED.photo, profiles.photo)
     RETURNING *`,
    [
      userId,
      fields.name ?? null, fields.age ?? null, fields.gender ?? null, fields.lookingFor ?? null,
      fields.pays ?? null, fields.ville ?? null, fields.commune ?? null, fields.langues ?? null, fields.bio ?? null,
      fields.photo ?? null
    ]
  );
  return mapProfile(res.rows[0]);
}

async function hasLiked(fromUserId, toUserId) {
  const res = await pool.query(
    'SELECT 1 FROM likes WHERE from_user_id = $1 AND to_user_id = $2', [fromUserId, toUserId]
  );
  return res.rowCount > 0;
}

async function hasPassed(fromUserId, toUserId) {
  const res = await pool.query(
    'SELECT 1 FROM passes WHERE from_user_id = $1 AND to_user_id = $2', [fromUserId, toUserId]
  );
  return res.rowCount > 0;
}

async function findMatchBetween(userA, userB) {
  const res = await pool.query(
    `SELECT * FROM matches WHERE (user_a_id = $1 AND user_b_id = $2) OR (user_a_id = $2 AND user_b_id = $1)`,
    [userA, userB]
  );
  return mapMatch(res.rows[0]);
}

// Retourne { matched, match }
async function addLike(fromUserId, toUserId) {
  await pool.query(
    `INSERT INTO likes (id, from_user_id, to_user_id) VALUES ($1, $2, $3)
     ON CONFLICT (from_user_id, to_user_id) DO NOTHING`,
    [id(), fromUserId, toUserId]
  );

  const reciprocal = await hasLiked(toUserId, fromUserId);
  if (!reciprocal) return { matched: false, match: null };

  // Toujours stocker la paire dans le même ordre (le plus petit UUID en
  // premier) pour que la contrainte UNIQUE(user_a_id, user_b_id) empêche un
  // match en double, peu importe qui a liké qui en premier.
  const [a, b] = [fromUserId, toUserId].sort();
  const res = await pool.query(
    `INSERT INTO matches (id, user_a_id, user_b_id) VALUES ($1, $2, $3)
     ON CONFLICT (user_a_id, user_b_id) DO UPDATE SET user_a_id = EXCLUDED.user_a_id
     RETURNING *`,
    [id(), a, b]
  );
  return { matched: true, match: mapMatch(res.rows[0]) };
}

async function addPass(fromUserId, toUserId) {
  await pool.query(
    `INSERT INTO passes (id, from_user_id, to_user_id) VALUES ($1, $2, $3)
     ON CONFLICT (from_user_id, to_user_id) DO NOTHING`,
    [id(), fromUserId, toUserId]
  );
}

async function getCandidates(viewerUserId, filters) {
  const viewerProfile = await getProfile(viewerUserId);
  if (!viewerProfile) return [];

  const conditions = [
    `pr.user_id != $1`,
    `pr.name IS NOT NULL AND pr.age IS NOT NULL AND pr.gender IS NOT NULL AND pr.looking_for IS NOT NULL AND pr.ville IS NOT NULL`,
    `NOT EXISTS (SELECT 1 FROM likes l WHERE l.from_user_id = $1 AND l.to_user_id = pr.user_id)`,
    `NOT EXISTS (SELECT 1 FROM passes ps WHERE ps.from_user_id = $1 AND ps.to_user_id = pr.user_id)`,
    // Un blocage (peu importe qui a bloqué qui) retire le profil de la découverte.
    `NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = pr.user_id) OR (b.blocker_id = pr.user_id AND b.blocked_id = $1))`,
    // Compatibilité de genre : chacun doit correspondre à ce que l'autre recherche.
    `($2 = 'Les deux' OR $2 = pr.gender)`,
    `(pr.looking_for = 'Les deux' OR pr.looking_for = $3)`
  ];
  const params = [viewerUserId, viewerProfile.lookingFor, viewerProfile.gender];

  if (filters.ville) {
    params.push(filters.ville);
    conditions.push(`LOWER(pr.ville) = LOWER($${params.length})`);
  }
  if (filters.langue) {
    params.push(filters.langue);
    conditions.push(`$${params.length} = ANY(pr.langues)`);
  }
  if (filters.ageMin) {
    params.push(filters.ageMin);
    conditions.push(`pr.age >= $${params.length}`);
  }
  if (filters.ageMax) {
    params.push(filters.ageMax);
    conditions.push(`pr.age <= $${params.length}`);
  }
  if (filters.commune) {
    // ILIKE (partiel) plutôt qu'égalité stricte : la commune reste un champ
    // texte libre des deux côtés (pas de liste fermée), donc une correspondance
    // exacte serait trop fragile (accents, variantes d'orthographe...).
    params.push(filters.commune);
    conditions.push(`pr.commune ILIKE '%' || $${params.length} || '%'`);
  }

  // Boost VIP : les profils du pack VIP remontent en tête de la découverte des autres.
  const res = await pool.query(
    `SELECT pr.*, (u.plan = 'vip') AS boosted
     FROM profiles pr
     JOIN users u ON u.id = pr.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY boosted DESC, pr.created_at ASC`,
    params
  );
  return res.rows.map(mapProfile);
}

async function getMatchesForUser(userId) {
  const res = await pool.query(
    `SELECT * FROM matches m
     WHERE (m.user_a_id = $1 OR m.user_b_id = $1)
       -- Un match avec une personne bloquée (dans un sens ou l'autre) disparaît
       -- de la liste — la conversation reste en base mais n'est plus accessible.
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
         WHERE (b.blocker_id = $1 AND b.blocked_id IN (m.user_a_id, m.user_b_id))
            OR (b.blocked_id = $1 AND b.blocker_id IN (m.user_a_id, m.user_b_id))
       )
     ORDER BY m.created_at DESC`,
    [userId]
  );
  return res.rows.map(mapMatch);
}

function otherUserInMatch(match, userId) {
  return match.userAId === userId ? match.userBId : match.userAId;
}

function isUserInMatch(match, userId) {
  return match.userAId === userId || match.userBId === userId;
}

async function getMatchById(matchId) {
  const res = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  return mapMatch(res.rows[0]);
}

async function getMessages(matchId) {
  const res = await pool.query(
    'SELECT * FROM messages WHERE match_id = $1 ORDER BY created_at ASC', [matchId]
  );
  return res.rows.map(mapMessage);
}

async function addMessage(matchId, fromUserId, text) {
  const res = await pool.query(
    `INSERT INTO messages (id, match_id, from_user_id, text) VALUES ($1, $2, $3, $4) RETURNING *`,
    [id(), matchId, fromUserId, String(text).slice(0, 2000)]
  );
  return mapMessage(res.rows[0]);
}

// --- Packs (Standard / Premium / VIP) ---------------------------------

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function likesUsedToday(user) {
  if (!user.likesResetDate || user.likesResetDate !== todayKey()) return 0;
  return user.likesToday || 0;
}

// Nombre de likes qu'il reste à l'utilisateur pour aujourd'hui (Infinity si illimité).
function remainingLikesToday(user) {
  const plan = getUserPlan(user);
  if (plan.unlimitedLikes) return Infinity;
  return Math.max(0, plan.dailyLikeLimit - likesUsedToday(user));
}

function canLike(user) {
  return remainingLikesToday(user) > 0;
}

// À appeler uniquement quand un like est effectivement enregistré.
async function consumeLike(userId) {
  const key = todayKey();
  await pool.query(
    `UPDATE users SET
       likes_today = CASE WHEN likes_reset_date = $2 THEN likes_today + 1 ELSE 1 END,
       likes_reset_date = $2
     WHERE id = $1`,
    [userId, key]
  );
}

async function setPlan(userId, planId) {
  const validPlan = PLANS[planId] ? planId : 'gratuit';
  const res = await pool.query(
    `UPDATE users SET plan = $2 WHERE id = $1 RETURNING *`, [userId, validPlan]
  );
  return mapUser(res.rows[0]);
}

// Profils qui m'ont liké(e) mais que je n'ai pas encore liké(e)s en retour (pas de match).
async function getPeopleWhoLikedMe(userId) {
  const res = await pool.query(
    `SELECT pr.* FROM likes l
     JOIN profiles pr ON pr.user_id = l.from_user_id
     WHERE l.to_user_id = $1
       AND NOT EXISTS (SELECT 1 FROM likes l2 WHERE l2.from_user_id = $1 AND l2.to_user_id = l.from_user_id)
       AND NOT EXISTS (SELECT 1 FROM passes p WHERE p.from_user_id = $1 AND p.to_user_id = l.from_user_id)
       AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.blocker_id = $1 AND b.blocked_id = l.from_user_id) OR (b.blocker_id = l.from_user_id AND b.blocked_id = $1))
     ORDER BY l.created_at DESC`,
    [userId]
  );
  return res.rows.map(mapProfile);
}

// --- Blocage et signalement de profils ----------------------------------

async function blockUser(blockerId, blockedId) {
  if (blockerId === blockedId) return;
  await pool.query(
    `INSERT INTO blocks (id, blocker_id, blocked_id) VALUES ($1, $2, $3)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [id(), blockerId, blockedId]
  );
}

async function unblockUser(blockerId, blockedId) {
  await pool.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
}

// Bloqué dans un sens ou dans l'autre = considéré comme bloqué pour tout le
// monde (découverte, likes, chat, appels) — seule la page "Comptes bloqués"
// distingue qui a initié le blocage (blocker_id).
async function isBlocked(userA, userB) {
  const res = await pool.query(
    `SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`,
    [userA, userB]
  );
  return res.rowCount > 0;
}

async function getBlockedProfiles(userId) {
  const res = await pool.query(
    `SELECT pr.*, b.created_at AS blocked_at FROM blocks b
     JOIN profiles pr ON pr.user_id = b.blocked_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );
  return res.rows.map(row => Object.assign(mapProfile(row), { blockedAt: row.blocked_at }));
}

async function createReport(reporterId, reportedId, reason, details) {
  await pool.query(
    `INSERT INTO reports (id, reporter_id, reported_id, reason, details) VALUES ($1, $2, $3, $4, $5)`,
    [id(), reporterId, reportedId, reason, details ? String(details).trim().slice(0, 1000) || null : null]
  );
}

// --- Notifications push ---------------------------------------------------

function mapPushSubscription(row) {
  if (!row) return null;
  return { id: row.id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

// Un même endpoint (= un même navigateur/appareil) ne doit exister qu'une
// fois — s'il change de compte (ex: déconnexion/reconnexion sur le même
// téléphone) on le réattribue plutôt que d'échouer sur la contrainte UNIQUE.
async function addPushSubscription(userId, subscription) {
  await pool.query(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [id(), userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
  );
}

async function removePushSubscription(endpoint) {
  await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
}

async function getPushSubscriptionsForUser(userId) {
  const res = await pool.query('SELECT * FROM push_subscriptions WHERE user_id = $1', [userId]);
  return res.rows.map(mapPushSubscription);
}

// --- Commandes de paiement (CinetPay) -----------------------------------

// transaction_id CinetPay : alphanumérique, on évite les caractères spéciaux de l'UUID.
function newTransactionId() {
  return 'RC' + Date.now() + Math.random().toString(36).slice(2, 8).toUpperCase();
}

async function createOrder(userId, planId, amount, currency) {
  const res = await pool.query(
    `INSERT INTO orders (id, transaction_id, user_id, plan_id, amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [id(), newTransactionId(), userId, planId, amount, currency]
  );
  return mapOrder(res.rows[0]);
}

async function getOrderByTransactionId(transactionId) {
  const res = await pool.query('SELECT * FROM orders WHERE transaction_id = $1', [transactionId]);
  return mapOrder(res.rows[0]);
}

async function markOrderStatus(transactionId, status) {
  const res = await pool.query(
    `UPDATE orders SET status = $2, updated_at = now() WHERE transaction_id = $1 RETURNING *`,
    [transactionId, status]
  );
  return mapOrder(res.rows[0]);
}

module.exports = {
  LANGUES, VILLES, COUNTRY_CODES, COMMUNES_KINSHASA,
  normalizePhone, getUserByPhone, getUserById, createUser,
  getProfile, profileComplete, upsertProfile,
  hasLiked, hasPassed, addLike, addPass,
  getCandidates, getMatchesForUser, getMatchById, otherUserInMatch, isUserInMatch, findMatchBetween,
  getMessages, addMessage,
  remainingLikesToday, canLike, consumeLike, setPlan, getPeopleWhoLikedMe,
  createOrder, getOrderByTransactionId, markOrderStatus,
  blockUser, unblockUser, isBlocked, getBlockedProfiles, createReport,
  addPushSubscription, removePushSubscription, getPushSubscriptionsForUser,
};
