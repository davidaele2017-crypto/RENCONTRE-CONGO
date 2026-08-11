// Sons de l'app (sonnerie d'appel, tonalité d'attente, notification de
// message) — générés directement avec l'API Web Audio, aucun fichier audio à
// charger/héberger. Ce script est réinséré à chaque navigation pjax (comme
// calls.js/push.js) donc protégé par le même principe de garde-fou.
(function () {
  if (window.RCSounds) return;

  let ctx = null;
  function getCtx() {
    // Un AudioContext ne peut démarrer qu'après un geste utilisateur (clic) —
    // créé à la demande plutôt qu'au chargement de la page.
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Joue un bip (fréquence, durée en secondes, décalage de départ, volume).
  function tone(ac, freq, start, dur, gain = 0.18, type = 'sine') {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    osc.connect(g);
    g.connect(ac.destination);
    const t0 = ac.currentTime + start;
    // Petit fondu entrée/sortie pour éviter les "clics" audio.
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
    g.gain.setValueAtTime(gain, t0 + dur - 0.03);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // --- Boucles (sonnerie entrante / tonalité d'appel sortant) --------------
  // On reprogramme un motif toutes les `period` secondes via setInterval,
  // plutôt qu'un fichier audio en boucle — plus simple à démarrer/stopper net.
  function makeLoop(playPattern, period) {
    let timer = null;
    return {
      start() {
        if (timer) return;
        const ac = getCtx();
        playPattern(ac);
        timer = setInterval(() => playPattern(getCtx()), period * 1000);
      },
      stop() {
        if (timer) { clearInterval(timer); timer = null; }
      }
    };
  }

  // Tonalité d'attente côté appelant : deux bips graves façon "ça sonne chez
  // l'autre", motif classique répété toutes les 3s.
  const ringback = makeLoop((ac) => {
    tone(ac, 480, 0, 0.4, 0.14);
    tone(ac, 440, 0.45, 0.4, 0.14);
  }, 3);

  // Sonnerie d'appel entrant : motif un peu plus mélodique/enjoué pour
  // attirer l'attention, répété toutes les 2s.
  const ringtone = makeLoop((ac) => {
    tone(ac, 659, 0, 0.18, 0.16, 'triangle');
    tone(ac, 784, 0.2, 0.18, 0.16, 'triangle');
    tone(ac, 988, 0.4, 0.28, 0.16, 'triangle');
  }, 2);

  window.RCSounds = {
    startRingback: () => ringback.start(),
    stopRingback: () => ringback.stop(),
    startRingtone: () => ringtone.start(),
    stopRingtone: () => ringtone.stop(),
    stopAll() { ringback.stop(); ringtone.stop(); },
    // Petit "ding" à deux notes, joué une fois à la réception d'un message.
    playMessage() {
      try {
        const ac = getCtx();
        tone(ac, 880, 0, 0.09, 0.15, 'sine');
        tone(ac, 1320, 0.08, 0.14, 0.13, 'sine');
      } catch (e) {}
    }
  };
})();
