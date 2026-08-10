// Gestion des appels vocaux/vidéo (WebRTC) — chargé sur toutes les pages
// connectées pour pouvoir recevoir un appel entrant à tout moment.
//
// ⚠️ Limite connue : ce site n'est pas une "single-page app" — si tu navigues
// vers une autre page (clic sur un lien) pendant un appel, la page se recharge
// entièrement et l'appel est coupé. L'écran d'appel est donc volontairement en
// plein écran, pour éviter d'avoir à cliquer ailleurs pendant un appel.
(function () {
  let ws = null;
  let pc = null;
  let localStream = null;
  let currentMatchId = null;
  let currentMode = 'audio';
  let isCaller = false;
  let pendingCandidates = [];
  let iceServersCache = null;

  // --- UI : construite dynamiquement pour ne pas avoir à toucher chaque vue ---
  const ui = document.createElement('div');
  ui.id = 'call-ui';
  ui.innerHTML = `
    <div id="incoming-call-banner" class="call-banner" hidden>
      <span id="incoming-call-text"></span>
      <div class="call-banner-actions">
        <button type="button" id="decline-call-btn" class="btn btn-round btn-pass">✖️</button>
        <button type="button" id="accept-call-btn" class="btn btn-round btn-like">✅</button>
      </div>
    </div>
    <div id="call-overlay" class="call-overlay" hidden>
      <div id="call-status" class="call-status"></div>
      <video id="remote-video" class="remote-video" autoplay playsinline></video>
      <video id="local-video" class="local-video" autoplay playsinline muted></video>
      <div class="call-controls">
        <button type="button" id="toggle-mute-btn" class="btn btn-round">🎤</button>
        <button type="button" id="hangup-btn" class="btn btn-round btn-pass">📞</button>
      </div>
    </div>
  `;
  document.body.appendChild(ui);

  const incomingBanner = document.getElementById('incoming-call-banner');
  const incomingText = document.getElementById('incoming-call-text');
  const callOverlay = document.getElementById('call-overlay');
  const callStatus = document.getElementById('call-status');
  const remoteVideo = document.getElementById('remote-video');
  const localVideo = document.getElementById('local-video');

  let incomingCallInfo = null;

  function setStatus(text) { callStatus.textContent = text; }

  function showIncomingBanner(fromName, mode) {
    incomingText.textContent = `📞 ${fromName} t'appelle (${mode === 'video' ? 'vidéo' : 'vocal'})`;
    incomingBanner.hidden = false;
  }
  function hideIncomingBanner() { incomingBanner.hidden = true; }

  function showOverlay(mode) {
    callOverlay.hidden = false;
    localVideo.style.display = mode === 'video' ? '' : 'none';
    remoteVideo.style.display = mode === 'video' ? '' : 'none';
  }
  function hideOverlay() { callOverlay.hidden = true; }

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
      ws.addEventListener('close', () => { ws = null; setTimeout(connectSocket, 3000); });
      ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
    }).catch(() => setTimeout(connectSocket, 5000));
  }

  function send(message) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

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
      if (pc && pc.connectionState === 'connected') setStatus('En communication');
      if (pc && (pc.connectionState === 'failed' || pc.connectionState === 'disconnected')) {
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
    hideIncomingBanner();
    window.removeEventListener('beforeunload', warnBeforeUnload);
  }

  // --- Actions déclenchées par l'utilisateur ---

  window.startCall = async function (matchId, mode) {
    currentMatchId = matchId;
    currentMode = mode;
    isCaller = true;
    showOverlay(mode);
    setStatus('Appel en cours...');
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

  document.getElementById('accept-call-btn').addEventListener('click', async () => {
    if (!incomingCallInfo) return;
    const { matchId, mode } = incomingCallInfo;
    hideIncomingBanner();
    currentMatchId = matchId;
    currentMode = mode;
    isCaller = false;
    showOverlay(mode);
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
    send({ type: 'call-accept', matchId });
    incomingCallInfo = null;
  });

  document.getElementById('decline-call-btn').addEventListener('click', () => {
    if (incomingCallInfo) send({ type: 'call-decline', matchId: incomingCallInfo.matchId });
    incomingCallInfo = null;
    hideIncomingBanner();
  });

  document.getElementById('hangup-btn').addEventListener('click', () => {
    if (currentMatchId) send({ type: 'call-end', matchId: currentMatchId });
    cleanupCall();
  });

  document.getElementById('toggle-mute-btn').addEventListener('click', (e) => {
    if (!localStream) return;
    const track = localStream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    e.target.textContent = track.enabled ? '🎤' : '🔇';
  });

  // --- Messages venant du serveur de signalisation ---

  async function handleMessage(msg) {
    switch (msg.type) {
      case 'incoming-call':
        incomingCallInfo = { matchId: msg.matchId, mode: msg.mode };
        showIncomingBanner(msg.fromName, msg.mode);
        break;

      case 'call-accepted':
        if (msg.matchId !== currentMatchId || !isCaller) return;
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
        if (msg.reason === 'premium-required') {
          alert('Les appels sont réservés aux packs Premium et VIP. Va sur la page Premium pour en profiter.');
        } else if (msg.reason === 'offline') {
          alert('Cette personne n\'est pas connectée à l\'instant.');
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
    }
  }

  connectSocket();
})();
