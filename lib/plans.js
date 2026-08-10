// Définition des 3 formules — le seul endroit à modifier pour changer les
// tarifs ou les fonctionnalités de chaque pack.
//
// `price` est un prix indicatif en USD affiché sur la page /premium.
// `amount` est le montant RÉEL envoyé à CinetPay pour le paiement, dans la
// devise CINETPAY_CURRENCY (voir .env.example — XAF par défaut). Les montants
// en XAF/XOF doivent être des entiers (pas de centimes). Ajuste `amount` à ta
// devise et tes prix réels avant de passer en production.
const PLANS = {
  gratuit: {
    id: 'gratuit',
    name: 'Standard',
    price: 0,
    amount: 0,
    tagline: 'Pour découvrir l\'app',
    dailyLikeLimit: 10,
    unlimitedLikes: false,
    seeWhoLikedYou: false,
    advancedFilters: false,
    boost: false,
    calls: false,
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
    amount: 2000, // ≈ 2000 XAF/mois — à ajuster
    tagline: 'Pour multiplier tes chances',
    dailyLikeLimit: null,
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: false,
    boost: false,
    calls: true,
    features: [
      'Likes illimités',
      'Voir qui t\'a déjà liké',
      'Appels vocaux et vidéo avec tes matchs',
      'Filtres ville et langue',
      'Messagerie après match'
    ]
  },
  vip: {
    id: 'vip',
    name: 'VIP',
    price: 6.99,
    amount: 4000, // ≈ 4000 XAF/mois — à ajuster
    tagline: 'Pour une visibilité maximale',
    dailyLikeLimit: null,
    unlimitedLikes: true,
    seeWhoLikedYou: true,
    advancedFilters: true,
    boost: true,
    calls: true,
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
