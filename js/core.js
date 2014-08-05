'use strict';

window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;

/**
 * Calls onDOMReady when html is loaded, and onContentReady when everything is ready
 * TODO accept multiple callbacks
 */
document.onreadystatechange = function (e) {
    var state = document.readyState;
    if (state === 'interactive') {
        onDOMReady();
    } else if (state === 'complete') {
        if (typeof onContentReady !== 'undefined') {
            onContentReady();
        }
    }
};

function getTemplates() {
}

function Templates() {
    this.templates = {};
    this.handlers = {};
    this.hookups = {};

    this.currentTemplateName = null;
}
Templates.prototype.loadTemplates = function (givenTemplates) {
    var templates = !givenTemplates.length ? [givenTemplates] : givenTemplates;
    for (var i=0 ; i < templates.length ; i++) {
        var template = templates[i];
        this.templates[template.name] = template;
    }
};
Templates.prototype.on = function (name, handlers) {
    this.handlers[name] = handlers;
};
Templates.prototype.goTo = function (name, data) {
    var template = this.templates[name];
    if (!template) {
        throw new Error('No such template ' + name);
    }
    this.triggerHandler('unload');
    this.currentTemplateName = name;
    document.body.innerHTML = template.content;
    this.loadHookups();
    this.triggerHandler('load', data);
};
Templates.prototype.triggerHandler = function (name, data) {
    var handlers = this.handlers[this.currentTemplateName];
    if (handlers && handlers[name]) {
        handlers[name](data);
    }
};
Templates.prototype.loadHookups = function () {
    this.hookups = {};
    var thingsWithIds = document.querySelectorAll('[id]');
    var length = thingsWithIds.length;
    while (length--) {
        var thing = thingsWithIds[length];
        this.hookups[thing.id] = thing;
    }
};
Templates.prototype.loadTemplatesFromDOM = function () {
    var tmp = [];
    var elements = document.querySelectorAll('script[type="text/html"]');
    for (var i=0 ; i < elements.length ; i++) {
        var script = elements[i];
        tmp.push({
            name: script.id,
            content: script.innerText
        });
    }
    this.loadTemplates(tmp);
}

function Player(bpm, beats, intervals) {
    this.state = 'stopped';
    this.samples = [];
    this.bpm = bpm;
    this.beats = beats;
    this.intervals = intervals;
    this.timeout = null;
    this.beat = 0;

    this.nextAutoId = 0;

    this.onchange = null;
    this.onbeat = null;
}
Player.prototype.registerSample = function (sample) {
    var buffer = audioContext.createBuffer(1, sample.length, audioContext.sampleRate);
    buffer.getChannelData(0).set(sample, 0);
    var sampleBundle = new Sample(this.getNextId(), buffer);
    this.samples.push(sampleBundle);
    this.triggerChange();
};
Player.prototype.getSample = function (sampleId) {
    var withId = this.samples.filter(function (sample) {
        return sample.id === sampleId;
    })[0];
    return withId;
};
Player.prototype.getNextId = function () {
    return this.nextAutoId++;
};
Player.prototype.triggerChange = function () {
    if (this.onchange) {
        this.onchange();
    }
};
Player.prototype.removeSample = function (i) {
    this.samples.splice(i, 1);
};
Player.prototype.play = function () {
    this.setState('playing');
    this.playBeat();
};
Player.prototype.pause = function () {
    this.setState('paused');
};
Player.prototype.stop = function () {
    this.setState('stopped');
};
Player.prototype.setState = function (state) {
    this.state = state;
    if (this.onstatechange) {
        this.onstatechange();
    }
};
Player.prototype.isPlaying = function () {
    return this.state === 'playing';
};
Player.prototype.playBeatIn = function (millis) {
    this.timeout = setTimeout(this.playBeat.bind(this), millis);
};
Player.prototype.playBeat = function () {
    if (!this.isPlaying()) {
        return;
    }
    this.samples.filter(this.shouldPlaySample.bind(this)).map(this.playSample.bind(this));
    if (this.onbeat) {
        this.onbeat();
    }
    this.beat++;
    if (this.beat >= this.intervals * this.beats) {
        this.beat = 0;
    }
    this.playBeatIn(this.getIntervalInMillis());
};
Player.prototype.shouldPlaySample = function (sample) {
    return sample && sample.beats && sample.beats[this.beat];
};
Player.prototype.toggleBeat = function (sampleIndex, beatIndex) {
    var sample = this.samples[sampleIndex];
    if (!sample) {
        console.error('No such sample ' + sampleIndex);
        return;
    }
    sample.beats[beatIndex] = !sample.beats[beatIndex];
    this.triggerChange();
};
Player.prototype.playSample = function (sample) {
    sample.play(audioContext.destination);
};
Player.prototype.getIntervalInMillis = function () {
    return 60 * 1000 / this.bpm / this.intervals;
};

function Sample(id, data) {
    this._data = data;
    this.id = id;
    this._playbackRate = 1;

    // proxy a bundle of internal properties and nodes
    Object.defineProperty(this, 'pitch', {
        get: function () {
            return this._playbackRate;
        }, set: function (value) {
            var floatValue = Math.pow(2, parseInt(value));
            this._playbackRate = floatValue;
            this.triggerChange();
        }
    });
    Object.defineProperty(this, 'gain', {
        get: function () {
            return this.nodes.gain.value;
        }, set: function (value) {
            var floatValue = parseFloat(value);
            this.nodes.gain.value = floatValue;
            this.triggerChange();
        }
    });
    this.filter = {};
    Object.defineProperty(this.filter, 'frequency', {
        get: function () {
            return this.filter.frequency.value;
        }, set: function (value) {
            this.filter.frequency.value = value;
        }
    });
    Object.defineProperty(this.filter, 'type', {
        get: function () {
            return this.filter.type;
        }, set: function (value) {
            this.filter.type = value;
        }
    });

    this.beats = [];

    this.nodes = {};
    this.nodes.gain = audioContext.createGain();
    this.nodes.gain.value = 1;
    this.nodes.filter = audioContext.createBiquadFilter();
    this.nodes.type = 'lowpass';
    this.nodes.frequency.value = 5000;
}
Sample.prototype.play = function (destination, givenTime) {
    var time = givenTime || 0;
    var source = this.getNewSourceNode();
    wireUp([source, this.nodes.gain, destination]);
    source.start(time);
};
Sample.prototype.getNewSourceNode = function () {
    var source = audioContext.createBufferSource();
    source.buffer = this._data;
    source.playbackRate.value = this._playbackRate;
    console.log('using playbackRate of ', source.playbackRate);
    return source;
};
Sample.prototype.triggerChange = function () {
    if (this.onchange) {
        this.onchange();
    }
};
Sample.prototype.getData = function () {
    return this._data;
};

function onDrag(element, handler) {
    var isBeingMoved = false;
    var boundHandler = handler.bind(element);
    var downEvent = null;
    var previousEvent = null;
    element.addEventListener('mousedown', function (event) {
        isBeingMoved = true;
        previousEvent = downEvent = event;
    });
    element.addEventListener('mousemove', function (event) {
        if (!isBeingMoved) {
            return;
        }
        var oldPreviousEvent = previousEvent;
        previousEvent = event;
        boundHandler(event, oldPreviousEvent);
    });
    element.addEventListener('mouseup', onOutOrUp);
    element.addEventListener('mouseleave', onOutOrUp);
    function onOutOrUp() {
        isBeingMoved = false;
    }
}

var setupWorker = (function () {
    // ensure getUserMedia is only called once
    var requestSent = false;
    return function (callback) {
        if (!requestSent) {
            navigator.getUserMedia({audio: true}, callback);
            requestSent = true;
        }
    }
})();

/**
 * SampleSpooler keeps track of some samples from the source
 */
function SampleSpooler(source, audioContext, sampleCount, sampleSize) {
    this.sampleCount = sampleCount;
    this.sampleSize = sampleSize;
    this.numChannels = 2;
    this.contentIndex = 0;
    var totalSamples = this.sampleSize * this.sampleCount;
    this.contents = new Float32Array(totalSamples);

    // start listening to source
    if (audioContext) {
        this.processor = audioContext.createScriptProcessor(this.sampleSize, this.numChannels, this.numChannels);
        this.processor.onaudioprocess = this.onaudioprocess.bind(this);
    }

    this.onchange = null;
}
SampleSpooler.prototype.onaudioprocess = function (e) {
    var inputBuffer = e.inputBuffer;
    var left = inputBuffer.getChannelData(0);
    var right = inputBuffer.getChannelData(1);
    this.push(left);
}
SampleSpooler.prototype.push = function (value) {
    var offset = this.contentIndex * this.sampleSize;
    this.contentIndex++;
    if (this.contentIndex == this.sampleCount) {
        this.contentIndex = 0;
    }
    this.contents.set(value, offset);

    if (this.onsample) {
        this.onsample(this.dumpContents());
    }
}
SampleSpooler.prototype.dumpContents = function () {
    // get spooler state
    var index = this.contentIndex * this.sampleSize;
    var total = this.contents.length;

    // reorder data to start at 0, not index
    var firstBits = this.contents.subarray(index, total);
    var lastBits = this.contents.subarray(0, index);

    var data = new Float32Array(this.contents.length);
    data.set(firstBits, 0);
    data.set(lastBits, total - index);

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

/**
 * visualization functions
 */
function drawSound(sample, canvas, givenPointDrawingPartial) {
    var pointDrawingPartial = givenPointDrawingPartial || DrawingPartial.Amplitude;
    var context = canvas.getContext('2d');
    canvas.width = 1000;
    canvas.height = 250;
    var width = canvas.width;
    var samples = cloneToNormalArray(sample);
    var totalSamples = samples.length;
    var maximum = 0.08;
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

/**
 * map/reduce partials and array util
 */
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

function cloneToNormalArray(float32Array) {
    var normal = new Array(float32Array.length);
    for (var i = 0 ; i < float32Array.length ; i++) {
        normal[i] = float32Array[i];
    }
    return normal;
}

/**
 * connect each of the given nodes to the following node
 */
function wireUp(nodes) {
    var src, dst;
    for (var i=0 ; i < nodes.length-1 ; i++) {
        src = nodes[i];
        dst = nodes[i+1];
        src.connect(dst);
    }
    return dst;
}

/**
 * debugging functions
 */
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
