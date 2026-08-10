(function () {
  const win = document.getElementById('chat-window');
  const list = document.getElementById('message-list');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const matchId = win.dataset.matchId;

  function scrollToBottom() {
    win.scrollTop = win.scrollHeight;
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

  async function poll() {
    try {
      const res = await fetch(`/chat/${matchId}/messages.json`);
      if (!res.ok) return;
      const data = await res.json();
      let added = false;
      data.messages.forEach(m => {
        if (!knownIds.has(m.id)) {
          knownIds.add(m.id);
          renderMessage(m);
          added = true;
        }
      });
      if (added) scrollToBottom();
    } catch (e) { /* silencieux */ }
  }

  const intervalId = setInterval(poll, 3000);
  // Avec la navigation SPA (router.js), cette page peut être remplacée sans
  // rechargement complet — sans ça, l'intervalle continuerait de tourner
  // indéfiniment en arrière-plan pour un chat qu'on ne regarde plus.
  window.__pageCleanup = () => clearInterval(intervalId);

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
