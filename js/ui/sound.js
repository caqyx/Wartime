/* WT.sound — krótkie dźwięki syntezowane w WebAudio (bez plików): klik, koniec tury, bitwa, wydarzenie, alert, sukces.
 * Włącznik zapamiętywany w localStorage (ustawienie przeglądarki, nie zapisu gry). */
(function () {
  'use strict';
  var WT = window.WT = window.WT || {};
  var KEY = 'wartime_sound';
  var ac = null, master = null, last = {};

  function enabled() { try { return localStorage.getItem(KEY) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* tryb prywatny */ } }
  function ctx() {
    if (ac) return ac;
    var C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ac = new C(); master = ac.createGain(); master.gain.value = 0.18; master.connect(ac.destination);
    return ac;
  }
  /** Ton: częstotliwość (Hz) lub [od, do], czas (s), typ fali, opóźnienie (s), głośność. */
  function tone(freq, dur, type, delay, vol) {
    var a = ctx(); if (!a) return;
    var t = a.currentTime + (delay || 0), o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    if (Array.isArray(freq)) { o.frequency.setValueAtTime(freq[0], t); o.frequency.exponentialRampToValueAtTime(freq[1], t + dur); }
    else o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.6, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, delay, vol, cutoff) {
    var a = ctx(); if (!a) return;
    var n = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
    var src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(), t = a.currentTime + (delay || 0);
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = cutoff || 900; g.gain.value = vol || 0.7;
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }
  var SOUNDS = {
    click: function () { tone(880, 0.05, 'triangle', 0, 0.25); },
    order: function () { tone(520, 0.06, 'triangle', 0, 0.3); tone(780, 0.08, 'triangle', 0.05, 0.3); },
    turn: function () { tone(392, 0.18, 'sine', 0, 0.35); tone(587, 0.24, 'sine', 0.09, 0.3); },
    battle: function () { noise(0.45, 0, 0.9, 700); tone([140, 60], 0.35, 'sawtooth', 0, 0.25); },
    event: function () { tone(659, 0.12, 'sine', 0, 0.35); tone(988, 0.2, 'sine', 0.1, 0.3); },
    alert: function () { tone(740, 0.1, 'square', 0, 0.15); tone(740, 0.1, 'square', 0.16, 0.15); },
    win: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.25, 'triangle', i * 0.11, 0.3); }); },
    bad: function () { tone([330, 180], 0.35, 'sawtooth', 0, 0.2); }
  };
  /** Odtwarza dźwięk (z limitem 1 na 120 ms dla tego samego). */
  function play(name) {
    if (!enabled() || !SOUNDS[name]) return;
    var now = Date.now();
    if (last[name] && now - last[name] < 120) return;
    last[name] = now;
    try { var a = ctx(); if (a && a.state === 'suspended') a.resume(); SOUNDS[name](); } catch (e) { /* brak audio */ }
  }
  WT.sound = { play: play, enabled: enabled, setEnabled: setEnabled };
})();
