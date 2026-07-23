'use strict';
/* VOLT RUSH audio — synthesized e-bike soundscape. Motor whine follows
   speed + throttle load, inverter harmonic, freewheel clicks when coasting,
   tire/wind noise, brake squeal, pickup chimes, unlock fanfare. */
const AudioSys = (() => {
  let ctx = null, comp, master, noiseBuf;
  let inited = false, volume = 0.8;
  // continuous layers
  let motorOsc1, motorOsc2, invOsc, motorGain, invGain, motorLP;
  let windSrc, windLP, windGain;
  let squealGain, squealSrc;
  let freewheelNext = 0, beepNext = 0;

  function makeNoise(seconds) {
    const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * seconds, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function init() {
    if (inited) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    inited = true;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -15; comp.ratio.value = 7;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = volume;
    comp.connect(master); master.connect(ctx.destination);
    noiseBuf = makeNoise(2);

    // motor: two detuned saws + high inverter sine, through lowpass
    motorOsc1 = ctx.createOscillator(); motorOsc1.type = 'sawtooth';
    motorOsc2 = ctx.createOscillator(); motorOsc2.type = 'sawtooth';
    invOsc = ctx.createOscillator(); invOsc.type = 'sine';
    motorLP = ctx.createBiquadFilter(); motorLP.type = 'lowpass'; motorLP.frequency.value = 900;
    motorGain = ctx.createGain(); motorGain.gain.value = 0;
    invGain = ctx.createGain(); invGain.gain.value = 0;
    motorOsc1.connect(motorLP); motorOsc2.connect(motorLP);
    motorLP.connect(motorGain); motorGain.connect(comp);
    invOsc.connect(invGain); invGain.connect(comp);
    motorOsc1.start(); motorOsc2.start(); invOsc.start();

    // wind + tire rumble
    windSrc = ctx.createBufferSource(); windSrc.buffer = noiseBuf; windSrc.loop = true;
    windLP = ctx.createBiquadFilter(); windLP.type = 'lowpass'; windLP.frequency.value = 300;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windSrc.connect(windLP); windLP.connect(windGain); windGain.connect(comp);
    windSrc.start();

    // brake squeal bed
    squealSrc = ctx.createBufferSource(); squealSrc.buffer = noiseBuf; squealSrc.loop = true;
    const sBP = ctx.createBiquadFilter(); sBP.type = 'bandpass';
    sBP.frequency.value = 2300; sBP.Q.value = 9;
    squealGain = ctx.createGain(); squealGain.gain.value = 0;
    squealSrc.connect(sBP); sBP.connect(squealGain); squealGain.connect(comp);
    squealSrc.start();
  }

  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setVolume(v) { volume = v; if (master) master.gain.value = v; }

  function burst(o) {
    if (!inited) return;
    const t = ctx.currentTime + (o.when || 0);
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = (o.rate || 1) * (0.9 + Math.random() * 0.2);
    let node = s;
    if (o.bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = o.bp; f.Q.value = o.bq || 1; node.connect(f); node = f; }
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; node.connect(f); node = f; }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.decay || 0.1));
    node.connect(g); g.connect(comp);
    s.start(t); s.stop(t + (o.decay || 0.1) + 0.05);
  }

  function tone(o) {
    if (!inited) return;
    const t = ctx.currentTime + (o.when || 0);
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.decay || 0.15) * 0.85);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + (o.decay || 0.15));
    osc.connect(g); g.connect(comp);
    osc.start(t); osc.stop(t + (o.decay || 0.15) + 0.05);
  }

  /* per-frame engine state: v m/s, vmax, throttle 0..1, braking bool,
     coasting bool, grounded bool, lowBatt bool */
  function engine(v, vmax, throttle, braking, grounded, lowBatt) {
    if (!inited) return;
    const t = ctx.currentTime;
    const sp = v / vmax;
    // motor pitch: rises with speed, bumps with throttle load
    const f = 70 + sp * 480 + throttle * 40;
    motorOsc1.frequency.setTargetAtTime(f, t, 0.05);
    motorOsc2.frequency.setTargetAtTime(f * 1.012, t, 0.05);
    invOsc.frequency.setTargetAtTime(f * 6.04, t, 0.05);
    const mg = (throttle * 0.16 + sp * 0.05) * (grounded ? 1 : 0.7);
    motorGain.gain.setTargetAtTime(mg, t, 0.06);
    invGain.gain.setTargetAtTime(mg * 0.35 * sp, t, 0.06);
    motorLP.frequency.setTargetAtTime(500 + sp * 2400, t, 0.08);
    // wind & tire
    windGain.gain.setTargetAtTime(sp * sp * 0.22 + (grounded ? sp * 0.05 : 0), t, 0.1);
    windLP.frequency.setTargetAtTime(220 + sp * 1400, t, 0.1);
    // brake squeal only when braking at speed on ground
    squealGain.gain.setTargetAtTime(braking && grounded && v > 4 ? 0.05 + sp * 0.05 : 0, t, 0.04);
    // freewheel ticks when coasting
    if (grounded && throttle < 0.05 && v > 1.5 && t > freewheelNext) {
      burst({ bp: 4200, bq: 5, gain: 0.05 + sp * 0.04, decay: 0.012 });
      freewheelNext = t + 1 / (4 + v * 1.6);
    }
    // low battery beep
    if (lowBatt && t > beepNext) {
      tone({ type: 'square', f0: 1100, gain: 0.08, decay: 0.09 });
      tone({ type: 'square', f0: 1100, gain: 0.08, decay: 0.09, when: 0.15 });
      beepNext = t + 4;
    }
  }

  function pickup(gold) {
    tone({ type: 'sine', f0: gold ? 990 : 780, gain: 0.28, decay: 0.09 });
    tone({ type: 'sine', f0: gold ? 1480 : 1170, gain: 0.26, decay: 0.16, when: 0.07 });
  }
  function unlock() {
    const seq = [523, 659, 784, 1047, 1319];
    seq.forEach((f, i) => tone({ type: 'triangle', f0: f, gain: 0.3, decay: 0.3, when: i * 0.12 }));
  }
  function land(hard) {
    tone({ type: 'sine', f0: 90, f1: 45, gain: hard ? 0.7 : 0.35, decay: 0.12 });
    burst({ bp: 400, bq: 0.8, gain: hard ? 0.6 : 0.3, decay: 0.08 });
  }
  function crash() {
    burst({ bp: 500, bq: 0.6, gain: 0.9, decay: 0.25 });
    burst({ bp: 2200, bq: 2, gain: 0.5, decay: 0.15 });
    tone({ type: 'sawtooth', f0: 120, f1: 40, gain: 0.5, decay: 0.3 });
  }
  function bump() {
    tone({ type: 'sine', f0: 130, f1: 70, gain: 0.3, decay: 0.08 });
    burst({ bp: 900, bq: 1.5, gain: 0.3, decay: 0.05 });
  }
  function charge() {
    tone({ type: 'sine', f0: 620, f1: 880, gain: 0.06, decay: 0.25 });
  }
  function wheelieTick() {
    tone({ type: 'sine', f0: 1320, gain: 0.07, decay: 0.05 });
  }

  return {
    init, resume, setVolume, engine,
    pickup, unlock, land, crash, bump, charge, wheelieTick,
    get inited() { return inited; }
  };
})();
