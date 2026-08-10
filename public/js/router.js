// Routeur côté client "pjax-style" : transforme la navigation en
// mini single-page app SANS réécrire le site en framework JS.
//
// Principe : le serveur continue de renvoyer des pages HTML complètes et
// valides pour CHAQUE route (comme avant — ça reste donc fonctionnel sans JS,
// et un rechargement/lien direct marche toujours). Ce script intercepte les
// clics sur les liens et les envois de formulaires internes, va chercher la
// page cible en arrière-plan (fetch), puis ne remplace que le contenu de
// <div id="app-content"> au lieu de recharger toute la page.
//
// Pourquoi : ça évite de couper un appel audio/vidéo en cours (public/js/calls.js
// garde sa connexion WebSocket et son flux média vivants tant que la page ne se
// recharge pas complètement) et rend la navigation plus fluide.
//
// Pour qu'un lien ou formulaire garde l'ancien comportement (rechargement
// complet), ajoute l'attribut `data-full-reload` dessus — utilisé notamment
// pour le paiement CinetPay, qui redirige vers un autre site.
(function () {
  const APP_CONTENT_ID = 'app-content';

  function isRoutable(url) {
    try {
      const u = new URL(url, location.href);
      return u.origin === location.origin;
    } catch (e) {
      return false;
    }
  }

  // Exécute les <script> présents dans le nouveau contenu — un <script> inséré
  // via innerHTML ne s'exécute jamais tout seul, il faut le recréer.
  function runScripts(container) {
    container.querySelectorAll('script').forEach(oldScript => {
      const newScript = document.createElement('script');
      for (const attr of oldScript.attributes) newScript.setAttribute(attr.name, attr.value);
      newScript.textContent = oldScript.textContent;
      oldScript.replaceWith(newScript);
    });
  }

  async function swapContent(html, targetUrl, push) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newContent = doc.getElementById(APP_CONTENT_ID);
    const currentContent = document.getElementById(APP_CONTENT_ID);

    if (!newContent || !currentContent) {
      // Réponse inattendue (page d'erreur, contenu non standard...) —
      // on se rabat sur une vraie navigation plutôt que de casser l'affichage.
      location.assign(targetUrl);
      return;
    }

    // Nettoyage avant de jeter l'ancien contenu (ex: arrêter le polling du chat).
    if (typeof window.__pageCleanup === 'function') {
      try { window.__pageCleanup(); } catch (e) {}
      window.__pageCleanup = null;
    }

    document.title = doc.title;
    document.body.className = doc.body.className; // ex: .auth-page, .chat-page changent la mise en page
    document.body.dataset.loggedIn = doc.body.dataset.loggedIn || '';
    currentContent.replaceWith(newContent);
    runScripts(newContent);

    // Si la page qu'on vient de charger n'a plus de session active (ex: après
    // /logout), on coupe proprement une éventuelle connexion d'appel en cours.
    // (data-logged-in est présent sur TOUTES les pages, contrairement à
    // .plan-pill qui ne vit que dans la nav — absente sur la page de chat par
    // exemple, alors qu'on y est bien connecté.)
    if (!doc.body.dataset.loggedIn && typeof window.__RC_CALLS_TEARDOWN === 'function') {
      window.__RC_CALLS_TEARDOWN();
    }

    if (push) history.pushState({ rc: true }, '', targetUrl);
    window.scrollTo(0, 0);
  }

  async function navigate(url, options) {
    options = options || {};
    const push = options.push !== false; // false uniquement pour popstate (l'historique est déjà à jour)
    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        body: options.body,
        redirect: 'follow'
      });
      const html = await res.text();
      await swapContent(html, res.url, push);
    } catch (e) {
      location.assign(url); // hors ligne / erreur réseau → on retombe sur une vraie navigation
    }
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    if (link.hasAttribute('data-full-reload') || link.target === '_blank' || link.hasAttribute('download')) return;
    if (!isRoutable(link.href)) return;
    if (link.href === location.href) { e.preventDefault(); return; }

    e.preventDefault();
    navigate(link.href);
  });

  document.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return; // déjà géré par un script de page (ex: chat.js)
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.hasAttribute('data-full-reload')) return;
    const action = form.action || location.href;
    if (!isRoutable(action)) return;

    e.preventDefault();
    const method = (form.method || 'GET').toUpperCase();
    if (method === 'GET') {
      const params = new URLSearchParams(new FormData(form));
      const url = action.split('?')[0] + (params.toString() ? '?' + params.toString() : '');
      navigate(url);
    } else {
      // `new FormData(form)` envoyée telle quelle part TOUJOURS en
      // multipart/form-data, quel que soit l'enctype du formulaire — ça
      // casse express.urlencoded() côté serveur pour les formulaires
      // classiques (login, register, like/pass...). On ne garde le multipart
      // que si le formulaire le demande explicitement (upload de fichier),
      // sinon on repasse en x-www-form-urlencoded comme un vrai <form> le ferait.
      const isMultipart = form.enctype === 'multipart/form-data';
      const body = isMultipart ? new FormData(form) : new URLSearchParams(new FormData(form));
      navigate(action, { method, body });
    }
  });

  window.addEventListener('popstate', () => {
    navigate(location.href, { push: false });
  });

  history.replaceState({ rc: true }, '', location.href);
})();
