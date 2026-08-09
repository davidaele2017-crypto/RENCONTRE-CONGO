// Fonctions "métier" qui travaillent sur l'objet `data` chargé depuis db.js.
const { id } = require('./db');
const { PLANS, getUserPlan } = require('./plans');

const LANGUES = ['Lingala', 'Swahili', 'Kikongo', 'Tshiluba', 'Français', 'Anglais'];
const VILLES = {
  'RDC': ['Kinshasa', 'Lubumbashi', 'Mbuji-Mayi', 'Kananga', 'Kisangani', 'Bukavu', 'Goma', 'Kolwezi', 'Likasi', 'Matadi', 'Uvira', 'Butembo'],
  'Congo-Brazzaville': ['Brazzaville', 'Pointe-Noire', 'Dolisie', 'Nkayi', 'Owando', 'Ouesso', 'Impfondo']
};

const COUNTRY_CODES = { 'RDC': '243', 'Congo-Brazzaville': '242' };

// Transforme un numéro saisi localement (ex: "0812345678" ou "812 34 56 78")
// en format international stable (ex: "+243812345678") pour servir d'identifiant unique.
function normalizePhone(rawPhone, pays) {
  const code = COUNTRY_CODES[pays] || COUNTRY_CODES['RDC'];
  let digits = String(rawPhone || '').replace(/\D/g, '');
  digits = digits.replace(/^0+/, ''); // retire le 0 initial (format local)
  if (digits.startsWith(code)) digits = digits.slice(code.length); // évite le double préfixe
  return `+${code}${digits}`;
}

function getUserByPhone(data, phone) {
  return data.users.find(u => u.phone === phone);
}

function getUserById(data, userId) {
  return data.users.find(u => u.id === userId);
}

function getProfile(data, userId) {
  return data.profiles.find(p => p.userId === userId);
}

function profileComplete(profile) {
  return !!(profile && profile.name && profile.age && profile.gender && profile.lookingFor && profile.ville);
}

function upsertProfile(data, userId, fields) {
  let profile = getProfile(data, userId);
  if (!profile) {
    profile = { userId, createdAt: Date.now() };
    data.profiles.push(profile);
  }
  Object.assign(profile, fields);
  return profile;
}

function hasLiked(data, fromUserId, toUserId) {
  return data.likes.some(l => l.fromUserId === fromUserId && l.toUserId === toUserId);
}

function hasPassed(data, fromUserId, toUserId) {
  return data.passes.some(p => p.fromUserId === fromUserId && p.toUserId === toUserId);
}

function findMatchBetween(data, userA, userB) {
  return data.matches.find(m =>
    (m.userAId === userA && m.userBId === userB) ||
    (m.userAId === userB && m.userBId === userA)
  );
}

// Retourne { matched, match }
function addLike(data, fromUserId, toUserId) {
  if (!hasLiked(data, fromUserId, toUserId)) {
    data.likes.push({ id: id(), fromUserId, toUserId, createdAt: Date.now() });
  }
  if (hasLiked(data, toUserId, fromUserId)) {
    let match = findMatchBetween(data, fromUserId, toUserId);
    if (!match) {
      match = { id: id(), userAId: fromUserId, userBId: toUserId, createdAt: Date.now() };
      data.matches.push(match);
    }
    return { matched: true, match };
  }
  return { matched: false, match: null };
}

function addPass(data, fromUserId, toUserId) {
  if (!hasPassed(data, fromUserId, toUserId)) {
    data.passes.push({ id: id(), fromUserId, toUserId, createdAt: Date.now() });
  }
}

// Compatibilité de genre : chacun doit correspondre à ce que l'autre recherche.
function genderCompatible(viewerProfile, candidateProfile) {
  const viewerWants = viewerProfile.lookingFor === 'Les deux' || viewerProfile.lookingFor === candidateProfile.gender;
  const candidateWants = candidateProfile.lookingFor === 'Les deux' || candidateProfile.lookingFor === viewerProfile.gender;
  return viewerWants && candidateWants;
}

function getCandidates(data, viewerUserId, filters) {
  const viewerProfile = getProfile(data, viewerUserId);
  if (!viewerProfile) return [];
  const alreadyLiked = new Set(data.likes.filter(l => l.fromUserId === viewerUserId).map(l => l.toUserId));
  const alreadyPassed = new Set(data.passes.filter(p => p.fromUserId === viewerUserId).map(p => p.toUserId));

  const candidates = data.profiles.filter(p => {
    if (p.userId === viewerUserId) return false;
    if (!profileComplete(p)) return false;
    if (alreadyLiked.has(p.userId) || alreadyPassed.has(p.userId)) return false;
    if (!genderCompatible(viewerProfile, p)) return false;
    if (filters.ville && p.ville.toLowerCase() !== filters.ville.toLowerCase()) return false;
    if (filters.langue && !(p.langues || []).includes(filters.langue)) return false;
    if (filters.ageMin && p.age < filters.ageMin) return false;
    if (filters.ageMax && p.age > filters.ageMax) return false;
    return true;
  });

  // Boost VIP : les profils du pack VIP remontent en tête de la découverte des autres.
  // (tri stable : à statut de boost égal, l'ordre d'origine est conservé)
  return candidates
    .map(p => ({ p, boosted: getUserPlan(getUserById(data, p.userId)).boost }))
    .sort((a, b) => (b.boosted === a.boosted ? 0 : b.boosted ? 1 : -1))
    .map(x => x.p);
}

function getMatchesForUser(data, userId) {
  return data.matches.filter(m => m.userAId === userId || m.userBId === userId);
}

function otherUserInMatch(match, userId) {
  return match.userAId === userId ? match.userBId : match.userAId;
}

function isUserInMatch(match, userId) {
  return match.userAId === userId || match.userBId === userId;
}

function getMessages(data, matchId) {
  return data.messages
    .filter(m => m.matchId === matchId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function addMessage(data, matchId, fromUserId, text) {
  const msg = { id: id(), matchId, fromUserId, text: String(text).slice(0, 2000), createdAt: Date.now() };
  data.messages.push(msg);
  return msg;
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
function consumeLike(user) {
  const key = todayKey();
  if (user.likesResetDate !== key) {
    user.likesResetDate = key;
    user.likesToday = 0;
  }
  user.likesToday = (user.likesToday || 0) + 1;
}

function setPlan(data, userId, planId) {
  const user = getUserById(data, userId);
  if (!user) return null;
  user.plan = PLANS[planId] ? planId : 'gratuit';
  return user;
}

// Profils qui m'ont liké(e) mais que je n'ai pas encore liké(e)s en retour (pas de match).
function getPeopleWhoLikedMe(data, userId) {
  const passedByMe = new Set(data.passes.filter(p => p.fromUserId === userId).map(p => p.toUserId));
  const likerIds = [...new Set(
    data.likes
      .filter(l => l.toUserId === userId && !hasLiked(data, userId, l.fromUserId) && !passedByMe.has(l.fromUserId))
      .map(l => l.fromUserId)
  )];
  return likerIds.map(uid => getProfile(data, uid)).filter(Boolean);
}

module.exports = {
  LANGUES, VILLES, COUNTRY_CODES,
  normalizePhone, getUserByPhone, getUserById,
  getProfile, profileComplete, upsertProfile,
  hasLiked, hasPassed, addLike, addPass,
  getCandidates, getMatchesForUser, otherUserInMatch, isUserInMatch, findMatchBetween,
  getMessages, addMessage,
  remainingLikesToday, canLike, consumeLike, setPlan, getPeopleWhoLikedMe,
};
