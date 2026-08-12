// Gestion des appels vocaux/vidéo (WebRTC) — chargé sur toutes les pages
// connectées pour pouvoir recevoir un appel entrant à tout moment.
//
// Ce <script> est réinséré à chaque navigation "SPA" (voir public/js/router.js,
// qui ré-exécute les <script> présents dans le contenu remplacé, puisque
// nav.ejs — qui inclut ce fichier — fait partie du contenu rafraîchi à chaque
// page). On se protège donc avec un verrou global : la vraie connexion
// WebSocket et l'écran d'appel (ajoutés directement à <body>, donc jamais
// détruits par un changement de page) ne sont créés qu'une seule fois et
// survivent à la navigation — c'est ce qui permet à un appel de continuer
// même en changeant de page.
(function () {
  if (window.__RC_CALLS_READY) return;
  window.__RC_CALLS_READY = true;

  let ws = null;
  let pc = null;
  let localStream = null;
  let currentMatchId = null;
  let currentMode = 'audio';
  let isCaller = false;
  let pendingCandidates = [];
  let iceServersCache = null;
  let contactName = '';
  let contactPhoto = '';
  let callTimerInterval = null;
  let callConnectedAt = null;

  // --- Sortie audio (écouteur/oreillette vs haut-parleur) ------------------
  // Sur mobile, le flux WebRTC ressort souvent sur le haut-parleur par
  // défaut (comportement navigateur, pas un bug de l'app) au lieu de
  // l'écouteur comme un vrai appel téléphonique. HTMLMediaElement.setSinkId()
  // permet de corriger ça, mais son support est très inégal : Chrome
  // desktop/Android récents oui, Safari iOS jamais (l'OS gère seul la sortie
  // audio là-bas) — le bouton n'apparaît donc que si le navigateur le permet
  // réellement, pour ne pas proposer un bouton qui ne ferait rien.
  const sinkIdSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
  let speakerDeviceId = '';   // '' = sortie par défaut (souvent le haut-parleur sur mobile)
  let earpieceDeviceId = '';  // périphérique "écouteur"/"récepteur" trouvé, si l'appareil en expose un
  let onSpeaker = true;       // reflète l'état RÉEL de la sortie active (pas juste l'intention)

  // --- UI : construite dynamiquement pour ne pas avoir à toucher chaque vue ---
  // Deux écrans plein écran façon WhatsApp : l'un pour un appel entrant
  // (avatar + nom + accepter/refuser), l'autre pour l'appel en cours.
  const ui = document.createElement('div');
  ui.id = 'call-ui';
  ui.innerHTML = `
    <div id="incoming-call-screen" class="call-overlay incoming-call-screen" hidden>
      <div class="call-avatar-wrap">
        <div id="incoming-avatar" class="call-avatar call-avatar-pulse"><span id="incoming-avatar-fallback"></span></div>
      </div>
      <div id="incoming-call-name" class="call-name"></div>
      <div id="incoming-call-sub" class="call-substatus"></div>
      <div class="call-actions-incoming">
        <div class="call-action">
          <button type="button" id="decline-call-btn" class="btn btn-round btn-pass btn-call-lg" aria-label="Refuser">✖️</button>
          <span>Refuser</span>
        </div>
        <div class="call-action">
          <button type="button" id="accept-call-btn" class="btn btn-round btn-like btn-call-lg" aria-label="Accepter">✅</button>
          <span>Accepter</span>
        </div>
      </div>
    </div>
    <div id="call-overlay" class="call-overlay" hidden>
      <video id="remote-video" class="remote-video" autoplay playsinline></video>
      <div id="voice-avatar-wrap" class="call-avatar-wrap">
        <div id="voice-avatar" class="call-avatar"><span id="voice-avatar-fallback"></span></div>
      </div>
      <div id="call-name" class="call-name"></div>
      <div id="call-status" class="call-substatus"></div>
      <video id="local-video" class="local-video" autoplay playsinline muted></video>
      <div class="call-controls">
        <div class="call-action">
          <button type="button" id="toggle-mute-btn" class="btn btn-round">🎤</button>
          <span>Muet</span>
        </div>
        <div class="call-action">
          <button type="button" id="hangup-btn" class="btn btn-round btn-pass btn-call-lg">📞</button>
          <span>Terminer</span>
        </div>
        <div class="call-action" id="speaker-action" hidden>
          <button type="button" id="speaker-toggle-btn" class="btn btn-round">🔈</button>
          <span>Haut-parleur</span>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ui);

  const incomingScreen = document.getElementById('incoming-call-screen');
  const incomingAvatar = document.getElementById('incoming-avatar');
  const incomingAvatarFallback = document.getElementById('incoming-avatar-fallback');
  const incomingName = document.getElementById('incoming-call-name');
  const incomingSub = document.getElementById('incoming-call-sub');
  const callOverlay = document.getElementById('call-overlay');
  const callStatus = document.getElementById('call-status');
  const callNameEl = document.getElementById('call-name');
  const voiceAvatarWrap = document.getElementById('voice-avatar-wrap');
  const voiceAvatar = document.getElementById('voice-avatar');
  const voiceAvatarFallback = document.getElementById('voice-avatar-fallback');
  const remoteVideo = document.getElementById('remote-video');
  const localVideo = document.getElementById('local-video');
  const speakerAction = document.getElementById('speaker-action');
  const speakerBtn = document.getElementById('speaker-toggle-btn');

  let incomingCallInfo = null;

  function setAvatar(imgEl, fallbackEl, name, photoUrl) {
    fallbackEl.textContent = (name || '?').charAt(0).toUpperCase();
    if (photoUrl) {
      imgEl.style.backgroundImage = `url("${photoUrl}")`;
      imgEl.classList.add('call-avatar-photo');
    } else {
      imgEl.style.backgroundImage = '';
      imgEl.classList.remove('call-avatar-photo');
    }
  }

  function setStatus(text) { callStatus.textContent = text; }

  function stopCallTimer() {
    if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
    callConnectedAt = null;
  }

  function startCallTimer() {
    stopCallTimer();
    callConnectedAt = Date.now();
    callTimerInterval = setInterval(() => {
      const secs = Math.floor((Date.now() - callConnectedAt) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, '0');
      const s = String(secs % 60).padStart(2, '0');
      setStatus(`${m}:${s}`);
    }, 1000);
  }

  function showIncomingScreen(fromName, fromPhoto, mode) {
    setAvatar(incomingAvatar, incomingAvatarFallback, fromName, fromPhoto);
    incomingName.textContent = fromName || 'Quelqu\'un';
    incomingSub.textContent = mode === 'video' ? '📹 Appel vidéo entrant...' : '📞 Appel vocal entrant...';
    incomingScreen.hidden = false;
    window.RCSounds && window.RCSounds.startRingtone();
  }
  function hideIncomingScreen() {
    incomingScreen.hidden = true;
    window.RCSounds && window.RCSounds.stopRingtone();
  }

  function showOverlay(mode, name, photo) {
    callNameEl.textContent = name || '';
    setAvatar(voiceAvatar, voiceAvatarFallback, name, photo);
    callOverlay.hidden = false;
    const isVideo = mode === 'video';
    localVideo.style.display = isVideo ? '' : 'none';
    remoteVideo.style.display = isVideo ? '' : 'none';
    voiceAvatarWrap.hidden = isVideo;
  }
  function hideOverlay() {
    callOverlay.hidden = true;
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    window.RCSounds && window.RCSounds.stopRingback();
    stopCallTimer();
    speakerAction.hidden = true;
    onSpeaker = true;
  }

  function updateSpeakerBtnUI() {
    speakerBtn.textContent = onSpeaker ? '🔊' : '🔈';
    speakerBtn.classList.toggle('btn-active', onSpeaker);
  }

  // Repère, parmi les sorties audio de l'appareil, celle qui ressemble à un
  // haut-parleur et celle qui ressemble à un écouteur (labels standards des
  // navigateurs — pas de traduction possible, ils viennent du système).
  async function findAudioOutputs() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      const speaker = outputs.find(d => /speaker/i.test(d.label));
      const earpiece = outputs.find(d => /earpiece|receiver/i.test(d.label));
      return { speaker, earpiece };
    } catch (e) {
      return { speaker: null, earpiece: null };
    }
  }

  // Appelé une fois la connexion établie : si l'appareil expose bien un
  // écouteur distinct du haut-parleur, on bascule automatiquement dessus
  // pour un appel vocal (comme un vrai appel téléphonique) — la vidéo garde
  // le haut-parleur par défaut, plus logique pour ce cas d'usage.
  async function setupAudioOutput(mode) {
    speakerAction.hidden = true;
    if (!sinkIdSupported) return; // pas d'API -> pas de bouton plutôt qu'un bouton mort (ex: Safari iOS)

    const { speaker, earpiece } = await findAudioOutputs();
    speakerDeviceId = speaker ? speaker.deviceId : '';
    earpieceDeviceId = earpiece ? earpiece.deviceId : '';

    if (mode === 'audio' && earpiece) {
      try {
        await remoteVideo.setSinkId(earpiece.deviceId);
        onSpeaker = false;
      } catch (e) {
        onSpeaker = true;
      }
    } else {
      onSpeaker = true; // sortie par défaut (déjà le haut-parleur dans la plupart des cas)
    }

    // Le bouton n'a d'intérêt que s'il y a vraiment deux sorties différentes
    // à proposer — sinon "basculer" ne changerait rien.
    if (speaker || earpiece) {
      speakerAction.hidden = false;
      updateSpeakerBtnUI();
    }
  }

  speakerBtn.addEventListener('click', async () => {
    if (!sinkIdSupported) return;
    const goToSpeaker = !onSpeaker;
    const targetId = goToSpeaker ? speakerDeviceId : earpieceDeviceId;
    try {
      await remoteVideo.setSinkId(targetId || '');
      onSpeaker = goToSpeaker;
      updateSpeakerBtnUI();
    } catch (e) {
      // L'appareil refuse ce périphérique précis -> on ne change pas l'état affiché.
    }
  });

  function warnBeforeUnload(e) { e.preventDefault(); e.returnValue = ''; }

  async function getIceServers() {
    if (iceServersCache) return iceServersCache;
    const res = await fetch('/call/ice-servers');
    const json = await res.json();
    iceServersCache = json.iceServers;
    return iceServersCache;
  }

  function connectSocket() {
    fetch('/call/token').then(r => r.json()).then(({ token }) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/call/socket?token=${encodeURIComponent(token)}`);
      ws.addEventListener('message', (e) => handleMessage(JSON.parse(e.data)));
      ws.addEventListener('close', () => {
        ws = null;
        if (window.__RC_CALLS_READY) setTimeout(connectSocket, 3000); // pas de reconnexion après un teardown volontaire
      });
      ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
    }).catch(() => setTimeout(connectSocket, 5000));
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
  // Exposé pour que d'autres scripts (ex: chat.js, indicateur "écrit...")
  // puissent réutiliser la même connexion WebSocket sans en ouvrir une autre.
  window.__RC_WS_SEND = send;

  async function createPeerConnection() {
    const servers = await getIceServers();
    pc = new RTCPeerConnection({ iceServers: servers });

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ type: 'ice-candidate', matchId: currentMatchId, candidate: e.candidate });
    };
    pc.onconnectionstatechange = () => {
      if (pc && pc.connectionState === 'connected') {
        window.RCSounds && window.RCSounds.stopRingback();
        startCallTimer();
        setupAudioOutput(currentMode);
      }
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
        stopCallTimer();
        setStatus('Connexion perdue...');
      }
    };
  }

  // À appeler seulement après setRemoteDescription (sinon addIceCandidate échoue).
  async function flushPendingCandidates() {
    for (const c of pendingCandidates) {
      try { await pc.addIceCandidate(c); } catch (e) {}
    }
    pendingCandidates = [];
  }

  async function acquireMedia(mode) {
    const constraints = mode === 'video' ? { audio: true, video: true } : { audio: true, video: false };
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localVideo.srcObject = localStream;
  }

  function cleanupCall() {
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    currentMatchId = null;
    pendingCandidates = [];
    hideOverlay();
    hideIncomingScreen();
    window.RCSounds && window.RCSounds.stopAll();
    window.removeEventListener('beforeunload', warnBeforeUnload);
  }

  // --- Actions déclenchées par l'utilisateur ---

  window.startCall = async function (matchId, mode, name, photo) {
    currentMatchId = matchId;
    currentMode = mode;
    isCaller = true;
    contactName = name || '';
    contactPhoto = photo || '';
    showOverlay(mode, contactName, contactPhoto);
    setStatus('Appel en cours...');
    window.RCSounds && window.RCSounds.startRingback();
    window.addEventListener('beforeunload', warnBeforeUnload);
    try {
      await acquireMedia(mode);
    } catch (e) {
      setStatus('Impossible d\'accéder au micro/caméra');
      setTimeout(cleanupCall, 2000);
      return;
    }
    send({ type: 'call-invite', matchId, mode });
  };

  // Boutons d'appel dans le chat (data-attributes plutôt qu'un onclick inline,
  // pour ne pas avoir à échapper le nom/la photo du contact dans du JS inline).
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-call-mode]');
    if (!btn) return;
    window.startCall(btn.dataset.matchId, btn.dataset.callMode, btn.dataset.contactName, btn.dataset.contactPhoto);
  });

  document.getElementById('accept-call-btn').addEventListener('click', async () => {
    if (!incomingCallInfo) return;
    const { matchId, mode, fromName, fromPhoto } = incomingCallInfo;
    hideIncomingScreen();
    currentMatchId = matchId;
    currentMode = mode;
    isCaller = false;
    contactName = fromName || '';
    contactPhoto = fromPhoto || '';
    showOverlay(mode, contactName, contactPhoto);
    setStatus('Connexion...');
    window.addEventListener('beforeunload', warnBeforeUnload);
    try {
      await acquireMedia(mode);
      await createPeerConnection();
    } catch (e) {
      setStatus('Impossible d\'accéder au micro/caméra');
      setTimeout(cleanupCall, 2000);
      return;
    }
    send({ type: 'call-accepted', matchId });
    incomingCallInfo = null;
  });

  document.getElementById('decline-call-btn').addEventListener('click', () => {
    if (incomingCallInfo) send({ type: 'call-declined', matchId: incomingCallInfo.matchId });
    incomingCallInfo = null;
    hideIncomingScreen();
  });

  document.getElementById('hangup-btn').addEventListener('click', () => {
    if (currentMatchId) send({ type: 'call-ended', matchId: currentMatchId });
    cleanupCall();
  });

  document.getElementById('toggle-mute-btn').addEventListener('click', (e) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const btn = e.currentTarget;
    btn.textContent = track.enabled ? '🎤' : '🔇';
    btn.classList.toggle('btn-muted', !track.enabled);
  });

  // --- Messages venant du serveur de signalisation ---

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'incoming-call':
        incomingCallInfo = { matchId: msg.matchId, mode: msg.mode, fromName: msg.fromName, fromPhoto: msg.fromPhoto ? `/uploads/${msg.fromPhoto}` : '' };
        showIncomingScreen(msg.fromName, incomingCallInfo.fromPhoto, msg.mode);
        break;

      case 'call-accepted':
        if (msg.matchId !== currentMatchId || !isCaller) return;
        window.RCSounds && window.RCSounds.stopRingback();
        setStatus('Connexion...');
        await createPeerConnection();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'webrtc-offer', matchId: currentMatchId, sdp: offer });
        break;

      case 'call-declined':
        if (msg.matchId !== currentMatchId) return;
        setStatus('Appel refusé');
        setTimeout(cleanupCall, 1500);
        break;

      case 'call-failed':
        window.RCSounds && window.RCSounds.stopAll();
        if (msg.reason === 'premium-required') {
          alert('Les appels sont réservés aux packs Premium et VIP. Va sur la page Premium pour en profiter.');
        } else if (msg.reason === 'no-answer') {
          alert('Pas de réponse. La personne a été prévenue par notification mais n\'a pas décroché à temps.');
        } else if (msg.reason === 'blocked') {
          alert('Impossible d\'appeler cette personne.');
        }
        cleanupCall();
        break;

      case 'call-ended':
        if (msg.matchId !== currentMatchId) return;
        setStatus('Appel terminé');
        setTimeout(cleanupCall, 800);
        break;

      case 'webrtc-offer':
        if (msg.matchId !== currentMatchId || isCaller || !pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await flushPendingCandidates();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: 'webrtc-answer', matchId: currentMatchId, sdp: answer });
        break;

      case 'webrtc-answer':
        if (msg.matchId !== currentMatchId || !isCaller || !pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        await flushPendingCandidates();
        break;

      case 'ice-candidate':
        if (msg.matchId !== currentMatchId) return;
        const candidate = new RTCIceCandidate(msg.candidate);
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(candidate); } catch (e) {}
        } else {
          pendingCandidates.push(candidate);
        }
        break;

      // "Quelqu'un est en train d'écrire" — relayé tel quel par le serveur
      // (voir lib/signaling.js), consommé ici par chat.js via un événement DOM
      // pour ne pas coupler chat.js à la connexion WebSocket elle-même.
      case 'typing':
        document.dispatchEvent(new CustomEvent('rc:typing', { detail: msg }));
        break;
    }
  }

  // Appelé par router.js après une navigation qui atterrit sur une page où
  // l'utilisateur n'est plus connecté (ex: après /logout) — coupe proprement
  // la connexion au lieu de la laisser essayer de se reconnecter indéfiniment.
  window.__RC_CALLS_TEARDOWN = function () {
    cleanupCall();
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
    ui.remove();
    window.__RC_CALLS_READY = false;
    delete window.__RC_CALLS_TEARDOWN;
    delete window.startCall;
    delete window.__RC_WS_SEND;
  };

  connectSocket();
})();
