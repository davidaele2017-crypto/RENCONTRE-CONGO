// Définition des 3 formules — le seul endroit à modifier pour changer les
// tarifs ou les fonctionnalités de chaque pack.
//
// `price` est un prix de référence en USD (affiché en petit sur /premium).
// `pricing` contient le montant RÉEL envoyé à CinetPay, par pays — la RDC
// paie en CDF (franc congolais) et le Congo-Brazzaville en XAF (zone CEMAC),
// ce sont deux devises différentes chez CinetPay, donc un seul montant
// global ne peut pas être correct pour les deux pays en même temps. Les
// montants CDF/XAF n'acceptent pas de centimes (entiers uniquement).
//
// Calcul de ces montants (basé sur les coûts fixes mensuels réels de l'app —
// voir la conversation avec l'équipe technique) :
//   - Coûts fixes ≈ 19 $/mois (hébergement Render + abonnement marchand
//     CinetPay amorti sur l'année)
//   - Objectif : rester rentable même avec très peu d'abonnés payants —
//     avec ces prix, ~6 abonnés Premium (ou l'équivalent en VIP) suffisent
//     à couvrir les coûts fixes du mois, le reste est de la marge
//   - Taux utilisés pour la conversion (août 2026, à réajuster si le taux
//     bouge fortement) : 1 $ ≈ 2 270 CDF, 1 $ ≈ 600 XAF
const PLANS = {
  gratuit: {
    id: 'gratuit',
    name: 'Standard',
    price: 0,
    pricing: null,
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
    price: 3.49,
    pricing: {
      'RDC': { amount: 8000, currency: 'CDF' },
      'Congo-Brazzaville': { amount: 2100, currency: 'XAF' }
    },
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
    price: 7.99,
    pricing: {
      'RDC': { amount: 18000, currency: 'CDF' },
      'Congo-Brazzaville': { amount: 4800, currency: 'XAF' }
    },
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
      'Filtres avancés (tranche d\'âge, commune/quartier)',
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

// Montant + devise réels à facturer pour ce pack, selon le pays du profil
// (RDC -> CDF, Congo-Brazzaville -> XAF). Retourne null pour le pack gratuit.
function getPlanPricing(plan, pays) {
  if (!plan || !plan.pricing) return null;
  return plan.pricing[pays] || plan.pricing['RDC'];
}

module.exports = { PLANS, PLAN_ORDER, getPlan, getUserPlan, getPlanPricing };
