// Définition des 3 formules. Prix indicatifs en USD (à ajuster) — c'est le seul
// endroit à modifier pour changer les tarifs ou les fonctionnalités de chaque pack.
//
// ⚠️ Aucun vrai paiement n'est branché ici : le changement de pack est immédiat
// et gratuit côté code (bouton "démo"). Pour un vrai paiement, il faudrait
// intégrer un fournisseur (Mobile Money Orange/Airtel/M-Pesa, ou Stripe) dans
// la route POST /premium/choisir de server.js, et ne changer le pack qu'après
// confirmation du paiement (webhook ou callback du fournisseur).
const PLANS = {
  gratuit: {
    id: 'gratuit',
    name: 'Standard',
    price: 0,
    tagline: 'Pour découvrir l\'app',
    dailyLikeLimit: 10,
    unlimitedLikes: false,
    seeWhoLikedYou: false,
    advancedFilters: false,
    boost: false,
    features: [
      '10 likes par jour',
      'Filtres ville et langue',
      'Messagerie après match'
    ]
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    price: 2.99,
    tagline: 'Pour multiplier tes chances',
    dailyLikeLimit: null,
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: false,
    boost: false,
    features: [
      'Likes illimités',
      'Voir qui t\'a déjà liké',
      'Filtres ville et langue',
      'Messagerie après match'
    ]
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 6.99,
    tagline: 'Pour une visibilité maximale',
    dailyLikeLimit: null,
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: true,
    boost: true,
    features: [
      'Tout Premium, plus :',
      'Profil mis en avant (boost) dans la découverte',
      'Filtres avancés (tranche d\'âge)',
      'Badge VIP sur le profil'
    ]
  }
};

const PLAN_ORDER = ['gratuit', 'premium', 'vip'];

function getPlan(planId) {
  return PLANS[planId] || PLANS.gratuit;
}

function getUserPlan(user) {
  return getPlan(user && user.plan);
}

module.exports = { PLANS, PLAN_ORDER, getPlan, getUserPlan };
