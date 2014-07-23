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

    var input = wireUp([source, biquadFilter, gainNode]);

    var spool = new SampleSpooler(input, audioContext, 250);
    hookups["dump-sample"].onclick = function () {
        var contents = spool.dumpContents();
        console.log(contents);
    }

    var detector = new HitDetector(input, audioContext);
    detector.onhit = function () {
        var clampedSample = clampSample(spool.dumpContents());
        registerSound(clampedSample);
    }

    wireUp([input, spool.processor, detector.inspector, audioContext.destination]);
}

/**
 * SampleSpooler keeps track of spoolTime much samples from the source
 * Calling `dumpContents()` at t will return samples during [t - spoolTime, t]
 */
function SampleSpooler(source, audioContext, spoolTime) {
    this.bufferSize = 32;
    this.numChannels = 2;
    var sampleCount = this.bufferSize;// TODO be respectize of spoolTime
    this.contentIndex = sampleCount - 1;
    this.contents = new Array(sampleCount);
    var defaultContent = this.getDefaultContent();
    for (var i=0 ; i < sampleCount ; i++) {
        this.contents[i] = defaultContent;
    }

    // start listening to source
    this.processor = audioContext.createScriptProcessor();
    this.processor.onaudioprocess = this.onaudioprocess.bind(this);
}
SampleSpooler.prototype.onaudioprocess = function (e) {
    var inputBuffer = e.inputBuffer;
    this.push([inputBuffer.getChannelData(0), inputBuffer.getChannelData(1)]);
}
SampleSpooler.prototype.push = function (value) {
    this.contents[this.contentIndex++] = value;
    if (this.contentIndex > this.contents.length - 1) {
        this.contentIndex = 0;
    }
}
SampleSpooler.prototype.dumpContents = function () {
    // get spooler state
    var index = this.contentIndex;
    var contents = this.contents.slice(0);
    var total = contents.length;

    // reorder data to start at 0, not index
    var firstBits = contents.slice(index, total);
    var lastBits = contents.slice(0, index);
    var data = firstBits.concat(lastBits);
    return data;
}
SampleSpooler.prototype.getDefaultContent = function () {
    var channels = this.numChannels;
    var content = new Array(channels);
    for (var i=0 ; i < channels ; i++) {
        content[i] = new Float32Array();
    }
    return content;
}

function HitDetector(source, audioContext) {
    this.inspector = audioContext.createAnalyser();
    this.inspector.smoothingTimeConstant = 0.8;
    this.freqData = new Float32Array(this.inspector.frequencyBinCount);
    this.onhit = null;
    this.period = 15;
    this.startPumping();
}
HitDetector.prototype.startPumping = function () {
    var pump = this.pump.bind(this);
    setInterval(pump, this.period);
    pump();
}
HitDetector.prototype.pump = function () {
    this.inspector.getFloatFrequencyData(this.freqData);
    // if has hit and this.onhit
    //  this.onhit();
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

function registerSample(clampedSample) {
    console.log('got a sample');
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
