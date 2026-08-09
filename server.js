const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./lib/db');
const { hashPassword, verifyPassword } = require('./lib/password');
const store = require('./lib/store');
const plans = require('./lib/plans');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config générale -------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'congo-rencontre-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 jours
}));

// Rend `currentUser` et son pack (Standard/Premium/VIP) disponibles dans toutes les vues.
app.use((req, res, next) => {
  res.locals.currentUserId = req.session.userId || null;
  res.locals.currentPlan = null;
  res.locals.likedMeCount = 0;
  if (req.session.userId) {
    const data = db.load();
    const user = store.getUserById(data, req.session.userId);
    if (user) {
      res.locals.currentPlan = plans.getUserPlan(user);
      res.locals.likedMeCount = store.getPeopleWhoLikedMe(data, user.id).length;
    }
  }
  next();
});

// --- Upload de photo de profil ---------------------------------------
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `${req.session.userId}-${Date.now()}${ext}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
      return cb(new Error('Format d\'image non supporté'));
    }
    cb(null, true);
  }
});

// --- Middlewares ------------------------------------------------------
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function requireProfile(req, res, next) {
  const data = db.load();
  const profile = store.getProfile(data, req.session.userId);
  if (!store.profileComplete(profile)) {
    return res.redirect('/profile/edit?besoin=1');
  }
  next();
}

// --- Accueil ------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/browse' : '/login');
});

// --- Inscription / Connexion --------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/browse');
  res.render('register', { error: req.query.error || null });
});

app.post('/register', (req, res) => {
  const { phone, pays, password, password2 } = req.body;
  const data = db.load();

  if (!phone || !password) {
    return res.redirect('/register?error=' + encodeURIComponent('Merci de remplir tous les champs.'));
  }
  if (password.length < 6) {
    return res.redirect('/register?error=' + encodeURIComponent('Le mot de passe doit faire au moins 6 caractères.'));
  }
  if (password !== password2) {
    return res.redirect('/register?error=' + encodeURIComponent('Les mots de passe ne correspondent pas.'));
  }

  const normalizedPhone = store.normalizePhone(phone, pays);
  if (normalizedPhone.length < 8) {
    return res.redirect('/register?error=' + encodeURIComponent('Ce numéro de téléphone ne semble pas valide.'));
  }
  if (store.getUserByPhone(data, normalizedPhone)) {
    return res.redirect('/register?error=' + encodeURIComponent('Un compte existe déjà avec ce numéro.'));
  }

  const user = {
    id: db.id(),
    phone: normalizedPhone,
    passwordHash: hashPassword(password),
    plan: 'gratuit',
    likesToday: 0,
    likesResetDate: null,
    createdAt: Date.now()
  };
  data.users.push(user);
  db.save(data);

  req.session.userId = user.id;
  res.redirect('/profile/edit?besoin=1');
});

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/browse');
  res.render('login', { error: req.query.error || null });
});

app.post('/login', (req, res) => {
  const { phone, pays, password } = req.body;
  const data = db.load();
  const normalizedPhone = store.normalizePhone(phone, pays);
  const user = store.getUserByPhone(data, normalizedPhone);
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.redirect('/login?error=' + encodeURIComponent('Numéro ou mot de passe incorrect.'));
  }
  req.session.userId = user.id;
  res.redirect('/browse');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Profil ---------------------------------------------------------------
app.get('/profile/edit', requireAuth, (req, res) => {
  const data = db.load();
  const profile = store.getProfile(data, req.session.userId) || {};
  res.render('profile-edit', {
    profile,
    langues: store.LANGUES,
    villes: store.VILLES,
    besoin: req.query.besoin === '1',
    error: req.query.error || null
  });
});

app.post('/profile/edit', requireAuth, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.redirect('/profile/edit?error=' + encodeURIComponent(err.message));
    next();
  });
}, (req, res) => {
  const data = db.load();
  const { name, age, gender, lookingFor, pays, ville, bio } = req.body;
  let langues = req.body.langues || [];
  if (!Array.isArray(langues)) langues = [langues];

  if (!name || !age || !gender || !lookingFor || !ville) {
    return res.redirect('/profile/edit?error=' + encodeURIComponent('Merci de remplir au moins nom, âge, genre, recherche et ville.'));
  }

  const fields = {
    name: String(name).trim().slice(0, 60),
    age: Math.max(18, Math.min(99, parseInt(age, 10) || 18)),
    gender, lookingFor,
    pays: pays || 'RDC',
    ville: String(ville).trim(),
    langues,
    bio: String(bio || '').trim().slice(0, 500)
  };

  if (req.file) {
    fields.photo = req.file.filename;
  }

  store.upsertProfile(data, req.session.userId, fields);
  db.save(data);
  res.redirect('/browse');
});

// --- Parcourir / Liker ------------------------------------------------------
app.get('/browse', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const user = store.getUserById(data, req.session.userId);
  const plan = plans.getUserPlan(user);

  const filters = { ville: req.query.ville || '', langue: req.query.langue || '' };
  // Filtres avancés réservés au pack VIP — ignorés côté serveur pour tout le monde d'autre,
  // même si quelqu'un bricole l'URL pour les ajouter.
  if (plan.advancedFilters) {
    if (req.query.ageMin) filters.ageMin = parseInt(req.query.ageMin, 10) || undefined;
    if (req.query.ageMax) filters.ageMax = parseInt(req.query.ageMax, 10) || undefined;
  }

  const candidates = store.getCandidates(data, req.session.userId, filters);
  const candidate = candidates[0] || null;
  const candidateIsVip = candidate
    ? plans.getUserPlan(store.getUserById(data, candidate.userId)).boost
    : false;

  res.render('browse', {
    candidate,
    candidateIsVip,
    remaining: candidates.length,
    filters,
    villes: store.VILLES,
    langues: store.LANGUES,
    matched: req.query.matched || null,
    limite: req.query.limite === '1',
    remainingLikes: store.remainingLikesToday(user),
    plan
  });
});

app.post('/browse/like/:targetId', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const user = store.getUserById(data, req.session.userId);
  const qs = new URLSearchParams({ ville: req.body.ville || '', langue: req.body.langue || '' });
  if (req.body.ageMin) qs.set('ageMin', req.body.ageMin);
  if (req.body.ageMax) qs.set('ageMax', req.body.ageMax);

  if (!store.canLike(user)) {
    qs.set('limite', '1');
    return res.redirect('/browse?' + qs.toString());
  }

  const target = store.getUserById(data, req.params.targetId);
  if (!target) return res.redirect('/browse?' + qs.toString());

  const { matched } = store.addLike(data, req.session.userId, target.id);
  store.consumeLike(user);
  db.save(data);

  if (matched) {
    const targetProfile = store.getProfile(data, target.id);
    qs.set('matched', targetProfile ? targetProfile.name : '');
  }
  res.redirect('/browse?' + qs.toString());
});

app.post('/browse/pass/:targetId', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const qs = new URLSearchParams({ ville: req.body.ville || '', langue: req.body.langue || '' });
  if (req.body.ageMin) qs.set('ageMin', req.body.ageMin);
  if (req.body.ageMax) qs.set('ageMax', req.body.ageMax);
  store.addPass(data, req.session.userId, req.params.targetId);
  db.save(data);
  res.redirect('/browse?' + qs.toString());
});

// --- Qui m'a liké(e) — Premium/VIP -------------------------------------------
app.get('/liked-me', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const user = store.getUserById(data, req.session.userId);
  const plan = plans.getUserPlan(user);
  if (!plan.seeWhoLikedYou) {
    return res.redirect('/premium?upsell=liked-me');
  }
  const profiles = store.getPeopleWhoLikedMe(data, req.session.userId);
  res.render('liked-me', { profiles });
});

// --- Packs (Standard / Premium / VIP) -----------------------------------------
app.get('/premium', requireAuth, (req, res) => {
  const data = db.load();
  const user = store.getUserById(data, req.session.userId);
  res.render('premium', {
    plans: plans.PLANS,
    order: plans.PLAN_ORDER,
    currentPlanId: (user && user.plan) || 'gratuit',
    success: req.query.success === '1',
    upsell: req.query.upsell || null
  });
});

// ⚠️ Démo uniquement : le pack change instantanément, sans paiement réel.
// Pour brancher un vrai paiement (Mobile Money / Stripe), il faudrait ici :
// 1) rediriger vers le fournisseur de paiement avec le montant du pack choisi,
// 2) attendre sa confirmation (webhook ou callback),
// 3) n'appeler store.setPlan(...) qu'après cette confirmation.
app.post('/premium/choisir', requireAuth, (req, res) => {
  const data = db.load();
  store.setPlan(data, req.session.userId, req.body.plan);
  db.save(data);
  res.redirect('/premium?success=1');
});

// --- Matchs -----------------------------------------------------------------
app.get('/matches', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const matches = store.getMatchesForUser(data, req.session.userId)
    .map(m => {
      const otherId = store.otherUserInMatch(m, req.session.userId);
      const profile = store.getProfile(data, otherId);
      const msgs = store.getMessages(data, m.id);
      return { match: m, profile, lastMessage: msgs[msgs.length - 1] || null };
    })
    .filter(x => x.profile)
    .sort((a, b) => b.match.createdAt - a.match.createdAt);
  res.render('matches', { matches });
});

// --- Chat ---------------------------------------------------------------------
function loadMatchOr404(req, res, data) {
  const match = data.matches.find(m => m.id === req.params.matchId);
  if (!match || !store.isUserInMatch(match, req.session.userId)) {
    return null;
  }
  return match;
}

app.get('/chat/:matchId', requireAuth, requireProfile, (req, res) => {
  const data = db.load();
  const match = loadMatchOr404(req, res, data);
  if (!match) return res.status(404).send('Match introuvable.');
  const otherId = store.otherUserInMatch(match, req.session.userId);
  const profile = store.getProfile(data, otherId);
  const messages = store.getMessages(data, match.id);
  res.render('chat', { match, profile, messages, meId: req.session.userId });
});

app.get('/chat/:matchId/messages.json', requireAuth, (req, res) => {
  const data = db.load();
  const match = loadMatchOr404(req, res, data);
  if (!match) return res.status(404).json({ error: 'not found' });
  const messages = store.getMessages(data, match.id).map(m => ({
    id: m.id, text: m.text, createdAt: m.createdAt, mine: m.fromUserId === req.session.userId
  }));
  res.json({ messages });
});

app.post('/chat/:matchId/send', requireAuth, (req, res) => {
  const data = db.load();
  const match = loadMatchOr404(req, res, data);
  if (!match) return res.status(404).json({ error: 'not found' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'texte vide' });
  const msg = store.addMessage(data, match.id, req.session.userId, text);
  db.save(data);
  res.json({ ok: true, message: { id: msg.id, text: msg.text, createdAt: msg.createdAt, mine: true } });
});

app.listen(PORT, () => {
  console.log(`💛💙❤️  Rencontre Congo — http://localhost:${PORT}`);
});
