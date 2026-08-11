(function () {
  const win = document.getElementById('chat-window');
  const list = document.getElementById('message-list');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const matchId = win.dataset.matchId;
  const typingStatus = document.getElementById('chat-typing-status');

  function scrollToBottom() {
    win.scrollTop = win.scrollHeight;
  }

  function isNearBottom() {
    // Si la personne a remonté pour relire d'anciens messages, on ne lui
    // impose pas un défilement forcé vers le bas à chaque nouveau message.
    return win.scrollHeight - win.scrollTop - win.clientHeight < 120;
  }

  function renderMessage(m) {
    const li = document.createElement('li');
    li.className = 'bubble ' + (m.mine ? 'mine' : 'theirs');
    li.textContent = m.text;
    li.dataset.id = m.id;
    list.appendChild(li);
  }

  let knownIds = new Set(Array.from(list.children).map(li => li.dataset.id));
  scrollToBottom();

  // --- Indicateur "en train d'écrire" (bulle + statut dans l'en-tête) ------
  let typingBubble = null;
  let typingHideTimer = null;

  function showTypingBubble() {
    if (typingStatus) typingStatus.hidden = false;
    if (!typingBubble) {
      typingBubble = document.createElement('li');
      typingBubble.className = 'bubble theirs typing-indicator';
      typingBubble.innerHTML = '<span></span><span></span><span></span>';
      list.appendChild(typingBubble);
      if (isNearBottom()) scrollToBottom();
    }
    clearTimeout(typingHideTimer);
    // Comme WhatsApp : si aucun nouvel événement "typing" n'arrive après
    // quelques secondes, on considère que la personne s'est arrêtée.
    typingHideTimer = setTimeout(hideTypingBubble, 3000);
  }

  function hideTypingBubble() {
    clearTimeout(typingHideTimer);
    typingHideTimer = null;
    if (typingStatus) typingStatus.hidden = true;
    if (typingBubble) { typingBubble.remove(); typingBubble = null; }
  }

  document.addEventListener('rc:typing', (e) => {
    if (e.detail && e.detail.matchId === matchId) showTypingBubble();
  });

  // Envoie un signal "j'écris" à l'autre personne, limité à un envoi toutes
  // les 2s pendant la frappe (pas besoin d'en envoyer à chaque caractère).
  let lastTypingSent = 0;
  input.addEventListener('input', () => {
    const now = Date.now();
    if (now - lastTypingSent < 2000) return;
    lastTypingSent = now;
    if (typeof window.__RC_WS_SEND === 'function') {
      window.__RC_WS_SEND({ type: 'typing', matchId });
    }
  });

  async function poll() {
    try {
      const res = await fetch(`/chat/${matchId}/messages.json`);
      if (!res.ok) return;
      const data = await res.json();
      let addedTheirs = false;
      let shouldScroll = false;
      data.messages.forEach(m => {
        if (!knownIds.has(m.id)) {
          knownIds.add(m.id);
          renderMessage(m);
          shouldScroll = true;
          if (!m.mine) addedTheirs = true;
        }
      });
      if (addedTheirs) {
        hideTypingBubble(); // le message est arrivé, plus la peine d'afficher "écrit..."
        window.RCSounds && window.RCSounds.playMessage();
      } else if (shouldScroll && typingBubble) {
        // Remet la bulle "écrit..." après les nouveaux messages plutôt qu'au milieu.
        list.appendChild(typingBubble);
      }
      if (shouldScroll && isNearBottom()) scrollToBottom();
    } catch (e) { /* silencieux */ }
  }

  const intervalId = setInterval(poll, 3000);
  // Avec la navigation SPA (router.js), cette page peut être remplacée sans
  // rechargement complet — sans ça, l'intervalle continuerait de tourner
  // indéfiniment en arrière-plan pour un chat qu'on ne regarde plus.
  window.__pageCleanup = () => { clearInterval(intervalId); clearTimeout(typingHideTimer); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try {
      const res = await fetch(`/chat/${matchId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await res.json();
      if (data.ok) {
        knownIds.add(data.message.id);
        renderMessage(data.message);
        scrollToBottom();
      }
    } catch (e) { /* silencieux */ }
  });
})();
