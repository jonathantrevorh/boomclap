'use strict';

var templates = new Templates();
var audioContext = new window.AudioContext();

function onDOMReady() {
    templates.loadTemplatesFromDOM();
    templates.goTo('index');
    start();
}

function start() {
    setupWorker(gotStream);
}

var player = new Player(140, 4, 4);
templates.on('player', (function () {
    var rawGridRow = null;
    var handlers = {
        load: function () {
            templates.hookups['record'].addEventListener('click', onRecordClick);
            templates.hookups['pad-grid'].addEventListener('click', onTogglePlaySample);
            templates.hookups['playpause'].addEventListener('click', onPlayPauseClick);
            rawGridRow = templates.hookups['grid-row'].cloneNode(true);
            player.onchange = redrawGrid;
            player.onbeat = onBeat;
            player.onstatechange = onPlayerStateChange;
            player.play();
            redrawGrid();
        },
        unload: function () {
            player.stop();
            player.onchange = null;
            player.onbeat = null;
        }
    };
    return handlers;
    function onRecordClick() {
        templates.goTo('record');
    };
    function onPlayPauseClick() {
        player[player.isPlaying() ? 'pause' : 'play']();
    };
    function onTogglePlaySample(event) {
        var target = event.target;
        var parent = target.parentElement;
        var sampleIndex = Array.prototype.indexOf.call(parent.parentElement.children, parent);
        var beatIndex = Array.prototype.indexOf.call(parent.children, target) - 1;
        player.toggleBeat(sampleIndex, beatIndex);
    };
    function onPlayerStateChange() {
        templates.hookups['playpause'].innerHTML = player.isPlaying() ? '&#9616;&#9616;' : '&#9658';
    };
    function redrawGrid() {
        var padGrid = templates.hookups['pad-grid'];
        padGrid.innerHTML = '';
        player.samples.map(function (sample, i) {
            var row = rawGridRow.cloneNode(true);
            row.id = '';
            row.name = sample.id;
            var nameNode = row.children[0];
            nameNode.innerText = sample.name;
            nameNode.addEventListener('click', onNameNodeClick);
            sample.beats.map(function (isOn, beat) {
                row.children[beat+1].classList[isOn ? 'add' : 'remove']('active');
            });
            padGrid.appendChild(row);
        });
        var lastRow = rawGridRow.cloneNode(true);
        padGrid.appendChild(lastRow);
    };
    function onBeat() {
        var beat = player.beat;
        var heads = templates.hookups['pad-head'].children;
        for (var i = 1 ; i < heads.length ; i++) {
            heads[i].classList[i == beat+1 ? 'add' : 'remove']('active');
        }
    };
    function onNameNodeClick() {
        var row = this.parentElement;
        var sampleId = row.name;
        templates.goTo('edit-sample', {sampleId: sampleId});
    };
})());

templates.on('record', (function () {
    var frozen = false;
    var samples = null;
    var handlers = {
        load: function () {
            setFrozen(false);
            templates.hookups['freeze'].addEventListener('click', onFreezeClick);
            templates.hookups['save'].addEventListener('click', onSaveClick);
            templates.hookups['cancel'].addEventListener('click', exit);
            onDrag(templates.hookups['left-handle'], moveWithDrag);
            onDrag(templates.hookups['right-handle'], moveWithDrag);
            toolChain.spool.onsample = onSample;
        },
        unload: function () {
            toolChain.spool.onsample = null;
        }
    };
    return handlers;

    function onFreezeClick() {
        setFrozen(!frozen);
    };
    function setFrozen(isFrozen) {
        frozen = isFrozen;
        templates.hookups['freeze'].innerText = frozen ? 'Unfreeze' : 'Freeze';
        templates.hookups['handles'].classList[frozen ? 'remove' : 'add']('hidden');
        templates.hookups['save'].disabled = !frozen;
    };
    function moveWithDrag(event, previousEvent) {
        var parent = templates.hookups['left-handle'].parentElement;
        var maxWidth = parent.offsetWidth;
        var children = parent.children;
        for (var i = 0 ; i < children.length ; i++) {
            maxWidth -= children[i].offsetWidth;
        }
        maxWidth += this.offsetWidth;
        var movement = previousEvent.screenX - event.screenX;
        var newWidth = this.offsetWidth + (this.id === 'left-handle' ? -1 : 1) * movement;
        var newWidth = Math.min(Math.max(0, newWidth), maxWidth);
        this.style.width = newWidth;
    }
    function onSaveClick() {
        var parentWidth = templates.hookups['left-handle'].parentElement.offsetWidth;
        var leftHandleWidth = templates.hookups['left-handle'].offsetWidth;
        var rightHandleWidth = templates.hookups['right-handle'].offsetWidth;
        var bounds = {
            lower: Math.floor(leftHandleWidth / parentWidth * samples.length),
            upper: Math.floor((1 - rightHandleWidth / parentWidth) * samples.length)
        };
        var clampedSample = samples.subarray(bounds.lower, bounds.upper);
        player.registerSample(clampedSample);
        exit();
    };
    function exit() {
        templates.goTo('player');
    }
    function onSample(newSamples) {
        if (!frozen) {
            samples = newSamples;
            drawSound(samples, templates.hookups['amplitude-graph'], DrawingPartial.Amplitude);
        }
    };
})());

templates.on('edit-sample', (function () {
    var sample = null;
    var canvas = null;
    var handlers = {
        load: function (data) {
            sample = player.getSample(data.sampleId);
            if (!sample) {
                // flash error
                console.error('no such sample ' + sampleId);
                templates.goTo('player');
                return;
            }
            canvas = templates.hookups['amplitude-graph'];
            templates.hookups['name'].value = sample.name;
            templates.hookups['name'].addEventListener('input', updateName);
            templates.hookups['pitch'].value = sample.pitch;
            templates.hookups['pitch'].addEventListener('input', updatePitch);
            templates.hookups['gain'].value = sample.gain;
            templates.hookups['gain'].addEventListener('input', updateGain);
            sample.onchange = draw;

            templates.hookups['save'].addEventListener('click', save);

            draw();
        },
        unload: function () {
            sample.onchange = null;
        }
    };
    return handlers;
    function updateName() {
        sample.name = this.value;
    }
    function updatePitch() {
        sample.pitch = this.value;
    }
    function updateGain() {
        sample.gain = this.value;
    }
    function draw() {
        drawSound(sample.getData(), canvas);
    }
    function save() {
        templates.goTo('player');
    }
})());

var toolChain = {
    spool: null,
};

function gotStream(stream) {
    templates.goTo('player');
    var source = audioContext.createMediaStreamSource(stream);

    var biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = 'lowpass';
    biquadFilter.frequency.value = 5000;

    /*var gainNode = audioContext.createGainNode();
    var volumeSlider = hookups['volume'];
    volumeSlider.value = 100*gainNode.gain.value;
    volumeSlider.onchange = function () {
        gainNode.gain.value = volumeSlider.value / 100;
    };*/

    var input = wireUp([source, biquadFilter]);

    toolChain.spool = new SampleSpooler(input, audioContext, 32, 2048);

    wireUp([input, toolChain.spool.processor, audioContext.destination]);
}
