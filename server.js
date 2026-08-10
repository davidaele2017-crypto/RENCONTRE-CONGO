const path = require('path');
// Charge .env depuis le dossier du projet, peu importe le dossier depuis lequel
// le process est lancé (important quand un outil externe démarre le serveur
// avec un autre dossier courant).
require('dotenv').config({ path: path.join(__dirname, '.env') });

const fs = require('fs');
const express = require('express');
const session = require('express-session');
const multer = require('multer');

const db = require('./lib/db');
const { hashPassword, verifyPassword } = require('./lib/password');
const store = require('./lib/store');
const plans = require('./lib/plans');
const cinetpay = require('./lib/cinetpay');
const sms = require('./lib/sms');
const callAuth = require('./lib/callAuth');
const iceServers = require('./lib/iceServers');
const { attachSignaling } = require('./lib/signaling');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const BASE_URL = (process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Express 4 ne rattrape pas automatiquement les erreurs d'un handler async —
// ce petit utilitaire les transmet à next(err) pour éviter qu'une requête
// reste bloquée sans réponse si une requête SQL échoue.
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

// Nécessaire pour que les cookies "secure" fonctionnent derrière le proxy
// inverse d'un hébergeur (Render, etc.) qui termine le HTTPS pour nous.
if (IS_PRODUCTION) app.set('trust proxy', 1);

// En production, pointe DATA_DIR vers un disque persistant pour ne pas perdre
// les photos de profil à chaque redéploiement.
const uploadsDir = path.join(process.env.DATA_DIR || __dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// --- Config générale -------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Le manifeste et le service worker doivent être servis depuis la racine
// (pas /public/...) pour que le service worker contrôle tout le site —
// sa "portée" par défaut est le dossier depuis lequel il est chargé.
app.get('/manifest.json', (req, res) => {
  res.type('application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});
app.get('/service-worker.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'service-worker.js'));
});
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'congo-rencontre-secret-dev',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 jours
    secure: IS_PRODUCTION, // cookie envoyé uniquement en HTTPS en production
  }
}));

// Vérification de vie pour l'hébergeur (Render ping cette route).
app.get('/healthz', (req, res) => res.status(200).send('OK'));

// Rend `currentUser` et son pack (Standard/Premium/VIP) disponibles dans toutes les vues.
app.use(h(async (req, res, next) => {
  res.locals.currentUserId = req.session.userId || null;
  res.locals.currentPlan = null;
  res.locals.likedMeCount = 0;
  req.currentUser = null;
  if (req.session.userId) {
    const user = await store.getUserById(req.session.userId);
    if (user) {
      req.currentUser = user; // évite de re-requêter le même utilisateur dans chaque route
      res.locals.currentPlan = plans.getUserPlan(user);
      res.locals.likedMeCount = (await store.getPeopleWhoLikedMe(user.id)).length;
    }
  }
  next();
}));

// --- Upload de photo de profil ---------------------------------------
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

const requireProfile = h(async (req, res, next) => {
  const profile = await store.getProfile(req.session.userId);
  if (!store.profileComplete(profile)) {
    return res.redirect('/profile/edit?besoin=1');
  }
  next();
});

// --- Accueil ------------------------------------------------------------
app.get('/', (req, res) => {
  res.redirect(req.session.userId ? '/browse' : '/login');
});

// --- Pages légales (publiques, pas besoin d'être connecté) --------------------
app.get('/cgu', (req, res) => res.render('cgu'));
app.get('/confidentialite', (req, res) => res.render('confidentialite'));

// --- Inscription / Connexion --------------------------------------------
app.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/browse');
  res.render('register', { error: req.query.error || null });
});

app.post('/register', h(async (req, res) => {
  const { phone, pays, password, password2, accept } = req.body;

  if (!phone || !password) {
    return res.redirect('/register?error=' + encodeURIComponent('Merci de remplir tous les champs.'));
  }
  if (!accept) {
    return res.redirect('/register?error=' + encodeURIComponent('Tu dois accepter les CGU et la politique de confidentialité pour t\'inscrire.'));
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
  if (await store.getUserByPhone(normalizedPhone)) {
    return res.redirect('/register?error=' + encodeURIComponent('Un compte existe déjà avec ce numéro.'));
  }

  // Évite de renvoyer un SMS (et de payer deux fois) si la personne resoumet
  // le formulaire pour le même numéro moins d'une minute après.
  const already = req.session.pendingRegistration;
  const now = Date.now();
  if (already && already.phone === normalizedPhone && now - already.startedAt < 60 * 1000) {
    return res.redirect('/verify-phone');
  }

  let demoCode = null;
  try {
    if (sms.isConfigured()) {
      await sms.startVerification(normalizedPhone);
    } else {
      // Mode démo (pas de compte Twilio configuré) : code généré nous-mêmes,
      // affiché directement sur la page de vérification au lieu d'un vrai SMS.
      demoCode = String(Math.floor(100000 + Math.random() * 900000));
      console.log(`[MODE DÉMO] Code de vérification pour ${normalizedPhone} : ${demoCode}`);
    }
  } catch (err) {
    console.error('Erreur envoi SMS :', err.message);
    return res.redirect('/register?error=' + encodeURIComponent('Impossible d\'envoyer le SMS de vérification. Vérifie le numéro et réessaie.'));
  }

  // Le compte n'est créé qu'après vérification du code (voir /verify-phone) —
  // on garde l'inscription "en attente" en session le temps de la saisie.
  req.session.pendingRegistration = {
    phone: normalizedPhone,
    passwordHash: hashPassword(password),
    demoCode,
    startedAt: now
  };
  res.redirect('/verify-phone');
}));

// --- Vérification du numéro par SMS -----------------------------------------
app.get('/verify-phone', (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');
  res.render('verify-phone', {
    phone: pending.phone,
    demoCode: pending.demoCode,
    error: req.query.error || null,
    resent: req.query.resent === '1'
  });
});

app.post('/verify-phone', h(async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');

  const code = (req.body.code || '').trim();
  if (!code) {
    return res.redirect('/verify-phone?error=' + encodeURIComponent('Entre le code reçu par SMS.'));
  }

  let approved = false;
  try {
    if (pending.demoCode) {
      approved = code === pending.demoCode;
    } else {
      const result = await sms.checkVerification(pending.phone, code);
      approved = result.approved;
    }
  } catch (err) {
    console.error('Erreur vérification SMS :', err.message);
    return res.redirect('/verify-phone?error=' + encodeURIComponent('Erreur de vérification, réessaie.'));
  }

  if (!approved) {
    return res.redirect('/verify-phone?error=' + encodeURIComponent('Code incorrect ou expiré.'));
  }

  // Sécurité supplémentaire (ex: deux onglets ouverts) — la contrainte UNIQUE
  // sur la colonne phone empêcherait de toute façon un doublon.
  if (await store.getUserByPhone(pending.phone)) {
    delete req.session.pendingRegistration;
    return res.redirect('/login?error=' + encodeURIComponent('Ce numéro est déjà enregistré, connecte-toi.'));
  }

  const user = await store.createUser({ phone: pending.phone, passwordHash: pending.passwordHash });
  delete req.session.pendingRegistration;
  req.session.userId = user.id;
  res.redirect('/profile/edit?besoin=1');
}));

app.post('/verify-phone/resend', h(async (req, res) => {
  const pending = req.session.pendingRegistration;
  if (!pending) return res.redirect('/register');

  const now = Date.now();
  if (now - pending.startedAt < 45 * 1000) {
    return res.redirect('/verify-phone?error=' + encodeURIComponent('Patiente un peu avant de redemander un code.'));
  }

  try {
    if (sms.isConfigured()) {
      await sms.startVerification(pending.phone);
      pending.startedAt = now;
    } else {
      pending.demoCode = String(Math.floor(100000 + Math.random() * 900000));
      pending.startedAt = now;
      console.log(`[MODE DÉMO] Nouveau code pour ${pending.phone} : ${pending.demoCode}`);
    }
    req.session.pendingRegistration = pending;
  } catch (err) {
    console.error('Erreur renvoi SMS :', err.message);
    return res.redirect('/verify-phone?error=' + encodeURIComponent('Impossible de renvoyer le SMS pour l\'instant.'));
  }

  res.redirect('/verify-phone?resent=1');
}));

app.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/browse');
  res.render('login', { error: req.query.error || null });
});

app.post('/login', h(async (req, res) => {
  const { phone, pays, password } = req.body;
  const normalizedPhone = store.normalizePhone(phone, pays);
  const user = await store.getUserByPhone(normalizedPhone);
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    return res.redirect('/login?error=' + encodeURIComponent('Numéro ou mot de passe incorrect.'));
  }
  req.session.userId = user.id;
  res.redirect('/browse');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// --- Profil ---------------------------------------------------------------
app.get('/profile/edit', requireAuth, h(async (req, res) => {
  const profile = (await store.getProfile(req.session.userId)) || {};
  res.render('profile-edit', {
    profile,
    langues: store.LANGUES,
    villes: store.VILLES,
    besoin: req.query.besoin === '1',
    error: req.query.error || null
  });
}));

app.post('/profile/edit', requireAuth, (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.redirect('/profile/edit?error=' + encodeURIComponent(err.message));
    next();
  });
}, h(async (req, res) => {
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

  await store.upsertProfile(req.session.userId, fields);
  res.redirect('/browse');
}));

// --- Parcourir / Liker ------------------------------------------------------
app.get('/browse', requireAuth, requireProfile, h(async (req, res) => {
  const user = req.currentUser;
  const plan = plans.getUserPlan(user);

  const filters = { ville: req.query.ville || '', langue: req.query.langue || '' };
  // Filtres avancés réservés au pack VIP — ignorés côté serveur pour tout le monde d'autre,
  // même si quelqu'un bricole l'URL pour les ajouter.
  if (plan.advancedFilters) {
    if (req.query.ageMin) filters.ageMin = parseInt(req.query.ageMin, 10) || undefined;
    if (req.query.ageMax) filters.ageMax = parseInt(req.query.ageMax, 10) || undefined;
  }

  const candidates = await store.getCandidates(req.session.userId, filters);
  const candidate = candidates[0] || null;
  let candidateIsVip = false;
  if (candidate) {
    const candidateUser = await store.getUserById(candidate.userId);
    candidateIsVip = plans.getUserPlan(candidateUser).boost;
  }

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
}));

app.post('/browse/like/:targetId', requireAuth, requireProfile, h(async (req, res) => {
  const user = req.currentUser;
  const qs = new URLSearchParams({ ville: req.body.ville || '', langue: req.body.langue || '' });
  if (req.body.ageMin) qs.set('ageMin', req.body.ageMin);
  if (req.body.ageMax) qs.set('ageMax', req.body.ageMax);

  if (!store.canLike(user)) {
    qs.set('limite', '1');
    return res.redirect('/browse?' + qs.toString());
  }

  const target = await store.getUserById(req.params.targetId);
  if (!target) return res.redirect('/browse?' + qs.toString());

  const { matched } = await store.addLike(req.session.userId, target.id);
  await store.consumeLike(user.id);

  if (matched) {
    const targetProfile = await store.getProfile(target.id);
    qs.set('matched', targetProfile ? targetProfile.name : '');
  }
  res.redirect('/browse?' + qs.toString());
}));

app.post('/browse/pass/:targetId', requireAuth, requireProfile, h(async (req, res) => {
  const qs = new URLSearchParams({ ville: req.body.ville || '', langue: req.body.langue || '' });
  if (req.body.ageMin) qs.set('ageMin', req.body.ageMin);
  if (req.body.ageMax) qs.set('ageMax', req.body.ageMax);
  await store.addPass(req.session.userId, req.params.targetId);
  res.redirect('/browse?' + qs.toString());
}));

// --- Qui m'a liké(e) — Premium/VIP -------------------------------------------
app.get('/liked-me', requireAuth, requireProfile, h(async (req, res) => {
  const user = req.currentUser;
  const plan = plans.getUserPlan(user);
  if (!plan.seeWhoLikedYou) {
    return res.redirect('/premium?upsell=liked-me');
  }
  const profiles = await store.getPeopleWhoLikedMe(req.session.userId);
  res.render('liked-me', { profiles });
}));

// --- Packs (Standard / Premium / VIP) -----------------------------------------
app.get('/premium', requireAuth, h(async (req, res) => {
  const user = req.currentUser;
  res.render('premium', {
    plans: plans.PLANS,
    order: plans.PLAN_ORDER,
    currentPlanId: (user && user.plan) || 'gratuit',
    success: req.query.success === '1',
    echec: req.query.echec === '1',
    upsell: req.query.upsell || null,
    paiementReel: cinetpay.isConfigured()
  });
}));

app.post('/premium/choisir', requireAuth, h(async (req, res) => {
  const planId = req.body.plan;
  const plan = plans.getPlan(planId);
  const user = req.currentUser;

  // Repasser en Standard (gratuit) ne coûte rien : aucun paiement à faire.
  if (planId === 'gratuit' || plan.amount === 0) {
    await store.setPlan(req.session.userId, 'gratuit');
    return res.redirect('/premium?success=1');
  }

  // Pas de compte CinetPay configuré (CINETPAY_API_KEY manquant) → mode démo :
  // on simule l'upgrade instantanément, gratuitement, pour pouvoir présenter
  // l'app avant d'avoir un vrai compte marchand.
  if (!cinetpay.isConfigured()) {
    await store.setPlan(req.session.userId, planId);
    return res.redirect('/premium?success=1');
  }

  const order = await store.createOrder(req.session.userId, planId, plan.amount, process.env.CINETPAY_CURRENCY || 'XAF');
  const profile = await store.getProfile(req.session.userId);

  cinetpay.initiatePayment({
    transactionId: order.transactionId,
    amount: order.amount,
    currency: order.currency,
    description: `Pack ${plan.name} — Rencontre Congo`,
    customer: {
      name: profile ? profile.name : 'Client',
      phone: user.phone,
      countryCode: (user.phone || '').startsWith('+242') ? 'CG' : 'CD'
    },
    notifyUrl: `${BASE_URL}/paiement/notifier`,
    returnUrl: `${BASE_URL}/paiement/retour?transaction_id=${order.transactionId}`
  }).then(({ paymentUrl }) => {
    res.redirect(paymentUrl);
  }).catch(async (err) => {
    console.error('Erreur CinetPay (initiatePayment) :', err.message);
    await store.markOrderStatus(order.transactionId, 'failed');
    res.redirect('/premium?echec=1');
  });
}));

// Le client revient ici après avoir payé (ou annulé) sur la page CinetPay.
app.get('/paiement/retour', requireAuth, h(async (req, res) => {
  const transactionId = req.query.transaction_id;
  if (!transactionId) return res.redirect('/premium');

  const order = await store.getOrderByTransactionId(transactionId);
  if (!order || order.userId !== req.session.userId) return res.redirect('/premium');

  if (order.status === 'completed') {
    return res.render('paiement-retour', { success: true, plan: plans.getPlan(order.planId) });
  }

  cinetpay.checkPaymentStatus(transactionId).then(async (result) => {
    if (result.accepted) {
      await store.setPlan(order.userId, order.planId);
      await store.markOrderStatus(transactionId, 'completed');
      return res.render('paiement-retour', { success: true, plan: plans.getPlan(order.planId) });
    }
    await store.markOrderStatus(transactionId, 'failed');
    res.render('paiement-retour', { success: false, plan: plans.getPlan(order.planId) });
  }).catch((err) => {
    console.error('Erreur CinetPay (checkPaymentStatus) :', err.message);
    res.render('paiement-retour', { success: false, plan: plans.getPlan(order.planId) });
  });
}));

// Notification serveur-à-serveur envoyée par CinetPay une fois le paiement
// traité (peut arriver avant OU après que le client revienne sur /paiement/retour).
// On ne fait jamais confiance au contenu du webhook : on revérifie toujours
// le statut réel via l'API CinetPay avant de créditer un compte.
app.post('/paiement/notifier', h(async (req, res) => {
  const transactionId = req.body.cpm_trans_id || req.body.transaction_id;
  if (!transactionId) return res.sendStatus(400);

  const order = await store.getOrderByTransactionId(transactionId);
  if (!order) return res.sendStatus(404);

  cinetpay.checkPaymentStatus(transactionId).then(async (result) => {
    await store.markOrderStatus(transactionId, result.accepted ? 'completed' : 'failed');
    if (result.accepted) await store.setPlan(order.userId, order.planId);
    res.sendStatus(200);
  }).catch((err) => {
    console.error('Erreur CinetPay (webhook) :', err.message);
    res.sendStatus(500);
  });
}));

// --- Matchs -----------------------------------------------------------------
app.get('/matches', requireAuth, requireProfile, h(async (req, res) => {
  const rawMatches = await store.getMatchesForUser(req.session.userId);
  const matches = [];
  for (const m of rawMatches) {
    const otherId = store.otherUserInMatch(m, req.session.userId);
    const profile = await store.getProfile(otherId);
    if (!profile) continue;
    const msgs = await store.getMessages(m.id);
    matches.push({ match: m, profile, lastMessage: msgs[msgs.length - 1] || null });
  }
  res.render('matches', { matches });
}));

// --- Chat ---------------------------------------------------------------------
async function loadMatchOr404(req, res) {
  const match = await store.getMatchById(req.params.matchId);
  if (!match || !store.isUserInMatch(match, req.session.userId)) {
    return null;
  }
  return match;
}

app.get('/chat/:matchId', requireAuth, requireProfile, h(async (req, res) => {
  const match = await loadMatchOr404(req, res);
  if (!match) return res.status(404).send('Match introuvable.');
  const otherId = store.otherUserInMatch(match, req.session.userId);
  const profile = await store.getProfile(otherId);
  const messages = await store.getMessages(match.id);
  res.render('chat', { match, profile, messages, meId: req.session.userId, canCall: plans.getUserPlan(req.currentUser).calls });
}));

app.get('/chat/:matchId/messages.json', requireAuth, h(async (req, res) => {
  const match = await loadMatchOr404(req, res);
  if (!match) return res.status(404).json({ error: 'not found' });
  const rawMessages = await store.getMessages(match.id);
  const messages = rawMessages.map(m => ({
    id: m.id, text: m.text, createdAt: m.createdAt, mine: m.fromUserId === req.session.userId
  }));
  res.json({ messages });
}));

app.post('/chat/:matchId/send', requireAuth, h(async (req, res) => {
  const match = await loadMatchOr404(req, res);
  if (!match) return res.status(404).json({ error: 'not found' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'texte vide' });
  const msg = await store.addMessage(match.id, req.session.userId, text);
  res.json({ ok: true, message: { id: msg.id, text: msg.text, createdAt: msg.createdAt, mine: true } });
}));

// --- Appels vocaux/vidéo (Premium/VIP) --------------------------------------
// Jeton de courte durée pour ouvrir la connexion WebSocket de signalisation
// (voir lib/callAuth.js et lib/signaling.js).
app.get('/call/token', requireAuth, (req, res) => {
  res.json({ token: callAuth.createToken(req.session.userId) });
});

app.get('/call/ice-servers', requireAuth, (req, res) => {
  res.json({ iceServers: iceServers.getIceServers() });
});

// Filet de sécurité : si un handler async plante (ex: base de données
// injoignable), on répond proprement plutôt que de laisser la requête
// pendre indéfiniment ou de faire planter le process.
app.use((err, req, res, next) => {
  console.error('Erreur non gérée :', err);
  if (res.headersSent) return next(err);
  res.status(500).send('Une erreur est survenue. Réessaie dans un instant.');
});

const httpServer = require('http').createServer(app);
attachSignaling(httpServer);

db.initSchema()
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`💛💙❤️  Rencontre Congo — http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Impossible d\'initialiser la base de données :', err);
    process.exit(1);
  });
