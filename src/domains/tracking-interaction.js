/** One arbitration point for camera hands and calibrated gaze.
 * Input hands are normalized DISPLAY coordinates (the camera adapter mirrors
 * once). No DOM, camera acquisition, storage, or external effects live here.
 */
export function createTrackingInteraction({ dispatch, isActive = () => true, onFocus = () => {}, clock = () => performance.now() } = {}) {
  let enabled = true, arrange = false, gazePinch = false, dwell = false;
  let sourceId = null, held = null, point = null, lastHandAt = -Infinity, gaze = null;
  let candidate = null, firedTarget = null, pair = null, gazeHover = false, handHover = false;
  const pinches = new Map(), armedHands = new Set();
  const finitePoint = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  const send = input => dispatch?.({ ...input, ...(input.type==='cancel'?{}:{arrange}) }) ?? {};
  function focus(result, p, source, progress = 0) { onFocus({ point: p, source, target: result?.target ?? null, held: Boolean(held), progress, reason: result?.reason ?? null }); }
  function cancel(reason = 'cancelled') {
    send({ type: 'cancel', source: 'hand', reason });
    held = null; point = null; pair = null; candidate = null; gazeHover = false; handHover = false; pinches.clear(); armedHands.clear();
    focus(null, null, null);
  }
  function resetSource(id) {
    if (id !== sourceId) { cancel('source-changed'); sourceId = id; gaze = null; firedTarget = null; }
  }
  function freshGaze(now) { return gaze?.valid && finitePoint(gaze.point) && now >= gaze.timestamp && now - gaze.timestamp < 350; }
  function handleHands(frame = {}) {
    if (!enabled) { cancel('controls-suspended'); return true; }
    if (!isActive()) { cancel('assembly-inactive'); return false; }
    resetSource(frame.source?.id ?? 'legacy');
    const now = frame.timestamp ?? clock(), receivedAt = clock(), hands = frame.hands ?? [], events = frame.lensEvents ?? [];
    if (!Number.isFinite(now) || now > receivedAt+50 || receivedAt-now > 350) {
      cancel('hand-frame-stale');return true;
    }
    const present = new Set(hands.map(hand => hand.handedness));
    for (const key of [...armedHands]) if (!present.has(key)) armedHands.delete(key);
    // A lost hand emits pinchend in the recognizer. It must cancel a preview,
    // never turn a disappearing/occluded hand into a click or saved drag.
    if (held && !present.has(held.hand)) { cancel('hand-lost'); return true; }
    for (const key of [...pinches.keys()]) if (!present.has(key)) pinches.delete(key);
    const starting = new Set(events.filter(e => e.type === 'pinchstart').map(e => e.hand));
    for (const hand of hands) if (!pinches.has(hand.handedness) && !starting.has(hand.handedness)) armedHands.add(hand.handedness);
    if (hands.length) { lastHandAt = now; candidate = null; gazeHover = false; }
    else if(handHover){send({type:'cancel',source:'hand',reason:'hand-lost'});handHover=false;focus(null,null,null);}
    for (const event of events) {
      if (event.type === 'pinchstart') {
        pinches.set(event.hand, event);
        if (!held && armedHands.has(event.hand) && finitePoint(event)) {
          const at = gazePinch ? (freshGaze(now) ? gaze.point : null) : event;
          if (!at) continue;
          held = { hand: event.hand, gazeAnchor: gazePinch ? { ...at } : null, handAnchor: { x: event.x, y: event.y } };
          point = { x: at.x, y: at.y };
          focus(send({ type: 'down', ...point, source: 'hand' }), point, 'hand');
        }
      } else if (event.type === 'pinchmove') {
        pinches.set(event.hand, event);
        if (held?.hand === event.hand && finitePoint(event)) {
          // Gaze selects once; hand displacement then owns the drag. Looking
          // elsewhere while pinching cannot teleport a held object.
          point = held.gazeAnchor ? {
            x: Math.max(0, Math.min(1, held.gazeAnchor.x + event.x - held.handAnchor.x)),
            y: Math.max(0, Math.min(1, held.gazeAnchor.y + event.y - held.handAnchor.y)),
          } : { x: event.x, y: event.y };
          focus(send({ type: 'move', ...point, source: 'hand' }), point, 'hand');
        }
      } else if (event.type === 'pinchend') {
        pinches.delete(event.hand);
        // Loss also emits pinchend. Only a hand still present has actually
        // opened; an occluded startup pinch must remain unarmed on return.
        if (present.has(event.hand)) armedHands.add(event.hand);
        pair = null;
        if (held?.hand === event.hand) {
          focus(send({ type: 'up', ...point, source: 'hand' }), point, 'hand');
          held = null;
        }
      }
    }
    if (held && arrange && pinches.size === 2) {
      const [a, b] = [...pinches.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([,p]) => p);
      const distance = Math.hypot(a.x-b.x, a.y-b.y), angle = Math.atan2(b.y-a.y, b.x-a.x);
      if (pair && pair.distance > .06 && distance > .06) {
        const factor = Math.max(.9, Math.min(1.1, distance/pair.distance));
        let radians = angle-pair.angle;
        if (radians > Math.PI) radians -= Math.PI*2;
        if (radians < -Math.PI) radians += Math.PI*2;
        send({ type: 'scale', ...point, source: 'hand', factor });
        send({ type: 'rotate', ...point, source: 'hand', radians: Math.max(-.15,Math.min(.15,radians)) });
      }
      pair = { distance, angle };
    } else pair = null;
    if (!held && hands.length) {
      const tip = hands[0]?.landmarks?.[8];
      const at = gazePinch && freshGaze(now) ? gaze.point : tip;
      if (finitePoint(at)) { point = { x:at.x, y:at.y }; handHover=true;focus(send({ type:'hover', ...point, source:'hand' }),point,'hand'); }
    } else if (!held && !hands.length && !freshGaze(now)) focus(null,null,null);
    return true;
  }
  function handleGaze(sample) {
    gaze = sample;
    const now = clock();
    if (!enabled || !isActive() || held || now-lastHandAt < 450) return;
    if (!freshGaze(now)) { candidate = null; if(gazeHover)send({type:'cancel',source:'gaze',reason:'gaze-lost'});gazeHover=false;focus(null,null,null); return; }
    const p = gaze.point, result = send({ type:'hover', ...p, source:'gaze' }), target = result?.target;
    gazeHover = true;
    handHover = false;
    const key = target ? `${target.kind}:${target.id}` : null;
    if (key !== firedTarget) firedTarget = null;
    if (!dwell || !target?.dwellAllowed || !key || key === firedTarget) { candidate = null; focus(result,p,'gaze'); return; }
    if (candidate?.key !== key || Math.hypot(p.x-candidate.x,p.y-candidate.y) > .08) candidate = {key, x:p.x,y:p.y,since:now};
    const progress = Math.min(1,(now-candidate.since)/1800);
    focus(result,p,'gaze',progress);
    if (progress === 1) {
      send({ type:'activate', ...p, source:'gaze', dwellArmed:true });
      firedTarget = key; candidate = null;
    }
  }
  return {
    handleHands, handleGaze, cancel,
    configure(options = {}) {
      cancel('controls-changed');
      if ('enabled' in options) enabled = Boolean(options.enabled);
      if ('arrange' in options) arrange = Boolean(options.arrange);
      if ('gazePinch' in options) gazePinch = Boolean(options.gazePinch);
      if ('dwell' in options) dwell = Boolean(options.dwell);
      firedTarget = null;
    },
    tick() { const now = clock(); if (held && now-lastHandAt > 700) cancel('tracking-stale'); if (!held && !freshGaze(now) && now-lastHandAt > 700) { candidate = null; if(gazeHover||handHover)send({type:'cancel',source:gazeHover?'gaze':'hand',reason:'tracking-stale'});gazeHover=false;handHover=false;focus(null,null,null); } },
    reset(reason = 'source-stopped') { cancel(reason); gaze = null; sourceId = null; lastHandAt = -Infinity; firedTarget = null; },
    snapshot: () => ({enabled,arrange,gazePinch,dwell,held:held?.hand??null,sourceId,dwellTarget:candidate?.key??null}),
  };
}
