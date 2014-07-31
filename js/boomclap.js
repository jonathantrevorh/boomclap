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
    hookups['dump-sample'].onclick = dumpAndClamp;
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

var toolChain = {
    spool: null,
};

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

    toolChain.spool = new SampleSpooler(input, audioContext, 250);
    var detector = new HitDetector(input, audioContext);
    detector.onhit = dumpAndClamp;

    wireUp([input, toolChain.spool.processor, detector.inspector, audioContext.destination]);
}

function dumpAndClamp() {
    var contents = toolChain.spool.dumpContents();
    clampSample(contents);
}

function clampSample(sample) {
    loadTemplate('clamp');
    hookups['save'].onclick = startPlayerUI;
    drawSound(sample, hookups['amplitude-graph'], DrawingPartial.Amplitude);
}

function registerSound(clampedSound) {
    ;
}

function drawSound(sample, canvas, pointDrawingPartial) {
    var context = canvas.getContext('2d');
    canvas.width = 1000;
    canvas.height = 250;
    var width = canvas.width;
    var samples = cloneToNormalArray(sample);
    /*
    var source = audioContext.createBufferSource();
    var buffer = audioContext.createBuffer(1, samples.length, 44100);
    var bufferArray = buffer.getChannelData(0);
    for (var i=0 ; i < samples.length ; i++) {
        bufferArray[i] = samples[i];
    }
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
    */
    var totalSamples = samples.length;
    var maximum = 0.05;
    var buckets = samples.reduce(bucket, new Array(width));
    var stepSize = width / buckets.length;
    for (var i=0 ; i < buckets.length ; i++) {
        var b = buckets[i];
        if (!b) continue;
        var avg = b.map(Math.abs).reduce(average, 0);
        var details = pointDrawingPartial(avg, maximum);
        drawRect(i, details.height, details.color);
    }
    function drawRect(x, height, color) {
        var newHeight = height * canvas.height;
        context.beginPath();
        context.fillStyle = color || '#000000';
        context.fillRect(x, canvas.height / 2 - newHeight, stepSize, newHeight * 2);
        context.stroke();
    }
}

var DrawingPartial = {
    Amplitude: function (sample, maximum) {
        return {
            height: sample / maximum,
            color: '#000000',
        };
    }
};

function cloneToNormalArray(float32Array) {
    var normal = new Array(float32Array.length);
    for (var i = 0 ; i < float32Array.length ; i++) {
        normal[i] = float32Array[i];
    }
    return normal;
}

function bucket(previousValue, currentValue, index, array) {
    var group = Math.floor(index / array.length * previousValue.length);
    previousValue[group] = previousValue[group] || [];
    previousValue[group].push(currentValue);
    return previousValue;
}

function add(previousValue, currentValue) {
    if (typeof previousValue != 'number') {
        previousValue = previousValue.reduce(add, 0);
    }
    if (typeof currentValue != 'number') {
        currentValue = currentValue.reduce(add, 0);
    }
    return previousValue + currentValue;
};

function max(previousValue, currentValue) {
    return previousValue > currentValue ? previousValue : currentValue;
}

function count(previousValue, currentValue) {
    return previousValue + 1;
}

function countDeep(previousValue, currentValue) {
    var newValue = 1;
    if (typeof currentValue !== 'number') {
        if (currentValue.reduce) {
            newValue = currentValue.reduce(countDeep, 0);
        } else {
            newValue = currentValue.length || 0;
        }
    }
    return previousValue + newValue;
}

function average(previousValue, currentValue, index, array) {
    return previousValue + currentValue / array.length;
}

function flatten(previousValue, currentValue) {
    return previousValue.concat(currentValue);
}

function flattenDeep(previousValue, currentValue) {
    var newValue = currentValue;
    if (Array.isArray(currentValue)) {
        newValue = currentValue.reduce(flattenDeep, []);
    } else if (currentValue instanceof Float32Array) {
        // specific case to handle audio api output, copy to regular array
        newValue = new Array(currentValue.length);
        for (var i=0 ; i < currentValue.length ; i++) {
            newValue[i] = currentValue[i];
        }
    }
    return previousValue.concat(newValue);
}

/**
 * SampleSpooler keeps track of spoolTime much samples from the source
 * Calling `dumpContents()` at t will return samples during [t - spoolTime, t]
 */
function SampleSpooler(source, audioContext, spoolTime) {
    this.bufferSize = 16;
    this.sampleSize = 4096;
    this.numChannels = 2;
    var sampleCount = this.bufferSize;// TODO be respectize of spoolTime
    this.contentIndex = 0;
    var totalSamples = this.sampleSize * this.bufferSize;
    console.log(totalSamples);
    this.contents = new Float32Array(totalSamples);

    // start listening to source
    if (audioContext) {
        this.processor = audioContext.createScriptProcessor(this.sampleSize, this.numChannels, this.numChannels);
        this.processor.onaudioprocess = this.onaudioprocess.bind(this);
    }
}
SampleSpooler.prototype.onaudioprocess = function (e) {
    var inputBuffer = e.inputBuffer;
    var left = inputBuffer.getChannelData(0);
    var right = inputBuffer.getChannelData(1);
    this.push(left);
}
SampleSpooler.prototype.push = function (value) {
    var offset = this.contentIndex * this.sampleSize;
    this.contents.set(value, offset);
    this.contentIndex++;
    if (this.contentIndex == this.bufferSize) {
        this.contentIndex = 0;
    }
    dumpAndClamp();
}
SampleSpooler.prototype.dumpContents = function () {
    // get spooler state
    var index = this.contentIndex * this.sampleSize;
    var total = this.contents.length;

    // reorder data to start at 0, not index
    var firstBits = this.contents.subarray(index, total);
    var lastBits = this.contents.subarray(0, index);

    var data = new Float32Array(this.contents.length);
    data.set(firstBits, index);
    data.set(lastBits, 0);

    return data;
}

function HitDetector(source, audioContext) {
    this.inspector = audioContext.createAnalyser();
    this.inspector.smoothingTimeConstant = 0.0;
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
    //  this.triggerHit();
    //this.triggerHit();
}
HitDetector.prototype.triggerHit = function () {
    if (!this.onhit) {
        return;
    }
    this.onhit();
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
