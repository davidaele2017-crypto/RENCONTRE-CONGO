// Liste des serveurs ICE (STUN/TURN) donnée au navigateur pour établir les
// appels. STUN (gratuit, Google) suffit souvent en Wifi mais pas de façon
// fiable sur toutes les connexions mobiles/4G.
//
// Pour ajouter un vrai serveur TURN plus tard (recommandé pour la fiabilité
// en 4G — ex: Twilio Network Traversal Service, Xirsys, ou un coturn auto-hébergé),
// il suffit de renseigner ces 3 variables d'environnement, aucun changement de
// code nécessaire :
//   TURN_URL=turn:ton-serveur-turn:3478
//   TURN_USERNAME=...
//   TURN_CREDENTIAL=...
function getIceServers() {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ];

  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || ''
    });
  }

  return servers;
}

module.exports = { getIceServers };
