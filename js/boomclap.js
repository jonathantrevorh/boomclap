'use strict';

var templates = {};
window.AudioContext = window.AudioContext || window.webkitAudioContext;
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia;
var audioContext = new window.AudioContext();

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
    setupWorker();
}

function getTemplates() {
    var tmp = {};
    var templateTags = new Array(document.querySelector('script[type="text/html"]'));
    templateTags.map(function (script) {
        tmp[script.id] = script.innerText;
    });
    return tmp;
}

function loadTemplate(id) {
    var html = templates[id];
    if (!html) {
        throw new Error('No such template ' + id);
    }
    document.body.innerHTML = html;
}

function onContentReady() {
}


function setupWorker() {
    navigator.getUserMedia({audio: true}, gotStream);
}

function gotStream(stream) {
    var source = audioContext.createMediaStreamSource(stream);

    var biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = BiquadFilterNode.LOWPASS;
    biquadFilter.frequency.value = 1000;

    var gainNode = audioContext.createGainNode();
    var volumeSlider = document.getElementById('volume');
    volumeSlider.onchange = function () {
        gainNode.gain.value = volumeSlider.value / 100;
    };

    var nodes = [];
    nodes.push(source);
    nodes.push(biquadFilter);
    nodes.push(gainNode);
    nodes.push(audioContext.destination);
    wireUp(nodes);
}

function wireUp(nodes) {
    for (var i=0 ; i < nodes.length-1 ; i++) {
        var src = nodes[i];
        var dst = nodes[i+1];
        src.connect(dst);
    }
}
