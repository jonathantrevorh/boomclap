'use strict';

var templates = {};
window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
var audioContext = new window.AudioContext();
var hookups = {};

document.onreadystatechange = function (e) {
    var state = document.readyState;
    if (state === 'interactive') {
        onDOMReady();
    } else if (state === 'complete') {
        onContentReady();
    }
};

function onDOMReady() {
    templates = getTemplates();
    loadTemplate('index');
    start();
}

function onContentReady() {
}

function getTemplates() {
    var tmp = {};
    var elements = document.querySelectorAll('script[type="text/html"]');
    for (var i=0 ; i < elements.length ; i++) {
        var script = elements[i];
        tmp[script.id] = script.innerText;
    }
    return tmp;
}

function loadTemplate(id) {
    var html = templates[id];
    if (!html) {
        throw new Error('No such template ' + id);
    }
    document.body.innerHTML = html;
    loadHookups();
}

function loadHookups() {
    hookups = {};
    var thingsWithIds = document.querySelectorAll('[id]');
    var length = thingsWithIds.length;
    while (length--) {
        var thing = thingsWithIds[length];
        hookups[thing.id] = thing;
    }
}

function start() {
    setupWorker();
}

function startPlayerUI() {
    loadTemplate('player');
}

var setupWorker = (function () {
    // ensure getUserMedia is only called once
    var requestSent = false;
    return function () {
        if (!requestSent) {
            navigator.getUserMedia({audio: true}, gotStream);
            requestSent = true;
        }
    }
})();

function gotStream(stream) {
    startPlayerUI();
    var source = audioContext.createMediaStreamSource(stream);

    var biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = BiquadFilterNode.LOWPASS;
    biquadFilter.frequency.value = 1000;

    var gainNode = audioContext.createGainNode();
    var volumeSlider = hookups['volume'];
    volumeSlider.value = 100*gainNode.gain.value;
    volumeSlider.onchange = function () {
        gainNode.gain.value = volumeSlider.value / 100;
    };

    var inspector = audioContext.createAnalyser();
    inspector.smoothingTimeConstant = 0.1;

    wireUp([source, biquadFilter, gainNode, inspector, audioContext.destination]);

    bootupInspector(inspector);
}

function wireUp(nodes) {
    var src, dst;
    for (var i=0 ; i < nodes.length-1 ; i++) {
        src = nodes[i];
        dst = nodes[i+1];
        src.connect(dst);
    }
    return dst;
}

function bootupInspector(inspector) {
    //setInterval(listenAndDump, 10);
    pump();
    var freqData = new Float32Array(inspector.frequencyBinCount);
    var rep = '';
    function listenAndDump() {
    }
    function pump() {
        inspector.getFloatFrequencyData(freqData);
        rep = dump(freqData, inspector.minDecibels, inspector.maxDecibels);
        hookups['dump'].innerText = rep;
        requestAnimationFrame(pump);
    }
}

// TODO make it easier to get fft data
// ideally something like: createFft(minFreq, maxFreq, smoothing, nbuckets)

function dump(data, min, max) {
    if (data == null) return '';
    var ss = '';
    for (var i=0 ; i < data.length ; i++) {
        var value = data[i];
        ss += repeat('#', 50*normalize(value, min, max)) + "\n";
    }
    return ss;
}

function repeat(s, randomN) {
    var ss = '';
    var n = parseInt(randomN);
    if (n < 0) return null;
    while (n--) ss += s;
    return ss;
}
function normalize(value, min, max) {
    var normalized = (value - min) / (max - min);
    return normalized;
}
