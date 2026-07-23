'use strict';
/* DUSTLINE audio engine — everything synthesized live in WebAudio.
   No sound files. Gunshots, footsteps, reloads, breathing, heartbeat,
   ambient wind, whizzes, impacts. */
const AudioSys = (() => {
  let ctx = null, comp, master, reverb, revGain, noiseBuf, shaperCurve;
  let inited = false, volume = 0.8;
  const breath = { gain: null, next: 0, level: 0 };
  const heart = { on: false, level: 0, next: 0 };

  function makeNoise(seconds) {
    const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * seconds, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeIR() {
    const sr = ctx.sampleRate, len = Math.floor(sr * 1.5);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.0) * 0.5;
      }
    }
    return buf;
  }

  function makeShaper() {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 3.2);
    }
    return curve;
  }

  function init() {
    if (inited) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    inited = true;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 8;
    comp.attack.value = 0.002; comp.release.value = 0.18;
    master = ctx.createGain(); master.gain.value = volume;
    comp.connect(master); master.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverb.buffer = makeIR();
    revGain = ctx.createGain(); revGain.gain.value = 0.65;
    reverb.connect(revGain); revGain.connect(comp);
    noiseBuf = makeNoise(2);
    shaperCurve = makeShaper();
    startAmbient();
    startBreath();
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { volume = v; if (master) master.gain.value = v; }

  /* Spatial channel: distance rolloff + lowpass with distance + reverb send.
     Returns input gain node. */
  function chan(vol, pan, dist, rev) {
    const g = ctx.createGain();
    g.gain.value = vol / (1 + dist * 0.075);
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.92, Math.min(0.92, pan || 0));
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(19000, 19000 / (1 + dist * 0.045));
    g.connect(p); p.connect(lp); lp.connect(comp);
    const rs = ctx.createGain();
    rs.gain.value = Math.min(0.9, (rev || 0.1) + dist * 0.014);
    lp.connect(rs); rs.connect(reverb);
    return g;
  }

  function burst(dest, o) {
    const t = ctx.currentTime + (o.when || 0);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = (o.rate || 1) * (0.85 + Math.random() * 0.3);
    let node = s;
    if (o.hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = o.hp; node.connect(f); node = f; }
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp; f.Q.value = o.bq || 1; node.connect(f); node = f; }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    if (o.drive) { const w = ctx.createWaveShaper(); w.curve = shaperCurve; node.connect(w); node = w; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.decay || 0.08));
    node.connect(g); g.connect(dest);
    s.start(t); s.stop(t + (o.decay || 0.08) + 0.05);
  }

  function tone(dest, o) {
    const t = ctx.currentTime + (o.when || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.decay || 0.15) * 0.8);
    let node = osc;
    if (o.drive) { const w = ctx.createWaveShaper(); w.curve = shaperCurve; node.connect(w); node = w; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.decay || 0.15));
    node.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + (o.decay || 0.15) + 0.05);
  }

  /* ---------- game sounds ---------- */

  function shot(kind, dist, pan) {
    if (!inited) return;
    dist = dist || 0; pan = pan || 0;
    const close = dist < 3;
    if (kind === 'rifle') {
      const c = chan(close ? 0.95 : 0.8, pan, dist, 0.2);
      burst(c, { hp: 900, gain: 1.0, decay: 0.05 });                       // supersonic crack
      burst(c, { bp: 340, bq: 0.7, gain: 0.95, decay: 0.11, drive: true }); // muzzle blast body
      tone(c, { type: 'triangle', f0: 130, f1: 42, gain: 0.95, decay: 0.15, drive: true }); // low boom
      if (close) burst(c, { bp: 2700, bq: 2.5, gain: 0.16, decay: 0.035, when: 0.055 }); // bolt cycling
    } else if (kind === 'pistol') {
      const c = chan(close ? 0.8 : 0.65, pan, dist, 0.16);
      burst(c, { hp: 1300, gain: 0.9, decay: 0.035 });
      burst(c, { bp: 620, bq: 0.8, gain: 0.7, decay: 0.07, drive: true });
      tone(c, { type: 'triangle', f0: 210, f1: 75, gain: 0.6, decay: 0.09, drive: true });
      if (close) burst(c, { bp: 3200, bq: 3, gain: 0.12, decay: 0.03, when: 0.04 }); // slide
    } else { // knife swing
      const c = chan(0.35, pan, dist, 0.05);
      burst(c, { bp: 950, bq: 1.2, gain: 0.6, decay: 0.1, rate: 1.6 });
    }
  }

  function step(vol, pan, dist, hard) {
    if (!inited) return;
    const c = chan(0.24 * vol, pan, dist || 0, 0.05);
    burst(c, { bp: 260 + Math.random() * 240, bq: 1.1, gain: 1.0, decay: 0.045 });
    burst(c, { hp: 2200, gain: hard ? 0.3 : 0.16, decay: 0.02 }); // grit scrape
  }

  function land(intensity) {
    if (!inited) return;
    const c = chan(Math.min(0.55, 0.22 + intensity * 0.35), 0, 0, 0.08);
    tone(c, { type: 'sine', f0: 82, f1: 46, gain: 0.9, decay: 0.1 });
    burst(c, { bp: 350, bq: 0.9, gain: 0.7, decay: 0.07 });
  }

  function reloadSnd(stage) {
    if (!inited) return;
    const c = chan(0.42, 0.15, 0, 0.06);
    if (stage === 0) {        // mag out
      burst(c, { bp: 1700, bq: 3, gain: 0.7, decay: 0.04 });
      tone(c, { type: 'square', f0: 290, gain: 0.12, decay: 0.05, when: 0.01 });
    } else if (stage === 1) { // mag in
      burst(c, { bp: 1100, bq: 2.5, gain: 0.85, decay: 0.05 });
      tone(c, { type: 'sine', f0: 170, gain: 0.35, decay: 0.06 });
    } else {                  // bolt / slide rack
      burst(c, { bp: 2900, bq: 3, gain: 0.75, decay: 0.035 });
      burst(c, { bp: 2400, bq: 3, gain: 0.75, decay: 0.045, when: 0.09 });
      tone(c, { type: 'sine', f0: 1500, gain: 0.07, decay: 0.11, when: 0.09 });
    }
  }

  function empty() {
    if (!inited) return;
    burst(chan(0.3, 0.1, 0, 0.03), { bp: 2300, bq: 4, gain: 0.8, decay: 0.03 });
  }

  function draw() {
    if (!inited) return;
    const c = chan(0.3, 0.1, 0, 0.04);
    burst(c, { bp: 1500, bq: 2, gain: 0.6, decay: 0.05 });
    burst(c, { bp: 2500, bq: 3, gain: 0.4, decay: 0.04, when: 0.07 });
  }

  function hit(head) {
    if (!inited) return;
    const c = chan(0.32, 0, 0, 0.02);
    tone(c, { type: 'square', f0: head ? 2700 : 2100, gain: 0.5, decay: 0.045 });
    if (head) tone(c, { type: 'square', f0: 3300, gain: 0.35, decay: 0.05, when: 0.045 });
  }

  function kill() {
    if (!inited) return;
    const c = chan(0.35, 0, 0, 0.06);
    tone(c, { type: 'sine', f0: 880, gain: 0.4, decay: 0.09 });
    tone(c, { type: 'sine', f0: 1318, gain: 0.4, decay: 0.14, when: 0.08 });
  }

  function hurt() {
    if (!inited) return;
    const c = chan(0.5, 0, 0, 0.05);
    tone(c, { type: 'sawtooth', f0: 150, f1: 85, gain: 0.35, decay: 0.13 });
    burst(c, { bp: 500, bq: 1, gain: 0.5, decay: 0.09 });
  }

  function whiz(pan) {
    if (!inited) return;
    burst(chan(0.28, pan, 0, 0.04), { bp: 3600, bq: 4, gain: 0.9, decay: 0.09, rate: 1.8 });
  }

  function impact(dist, pan) {
    if (!inited) return;
    const c = chan(0.3, pan, dist, 0.08);
    burst(c, { bp: 1400 + Math.random() * 1200, bq: 2, gain: 0.8, decay: 0.04 });
    burst(c, { bp: 500, bq: 1, gain: 0.4, decay: 0.06 });
  }

  /* ---------- continuous layers ---------- */

  function startAmbient() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const g = ctx.createGain(); g.gain.value = 0.02;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.009;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    s.connect(lp); lp.connect(g); g.connect(comp);
    s.start(); lfo.start();
  }

  function startBreath() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = 520; bp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100;
    const g = ctx.createGain(); g.gain.value = 0;
    s.connect(bp); bp.connect(lp); lp.connect(g); g.connect(comp);
    s.start();
    breath.gain = g;
    breath.next = ctx.currentTime + 1;
  }

  function breathSet(level) { breath.level = Math.max(0, Math.min(1, level)); }
  function heartSet(on, level) { heart.on = on; heart.level = level || 0; }

  function update() {
    if (!inited) return;
    const t = ctx.currentTime;
    // breathing cycle scheduler
    if (t >= breath.next && breath.gain) {
      const lvl = breath.level;
      const cyc = 4.6 - 2.4 * lvl;
      const peak = 0.006 + lvl * 0.1;
      const g = breath.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(peak * 0.65, t + cyc * 0.28); // inhale
      g.linearRampToValueAtTime(peak * 0.12, t + cyc * 0.42);
      g.linearRampToValueAtTime(peak, t + cyc * 0.60);        // exhale
      g.linearRampToValueAtTime(0.003, t + cyc * 0.94);
      breath.next = t + cyc;
    }
    // heartbeat
    if (heart.on && t >= heart.next) {
      const c = chan(0.4 + heart.level * 0.25, 0, 0, 0.02);
      tone(c, { type: 'sine', f0: 58, f1: 40, gain: 0.9, decay: 0.09 });
      tone(c, { type: 'sine', f0: 52, f1: 38, gain: 0.7, decay: 0.08, when: 0.17 });
      heart.next = t + (1.05 - heart.level * 0.4);
    }
  }

  return {
    init, resume, setVolume, update,
    shot, step, land, reload: reloadSnd, empty, draw,
    hit, kill, hurt, whiz, impact,
    breathSet, heartSet,
    get inited() { return inited; }
  };
})();
