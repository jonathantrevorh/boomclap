'use strict';

var templates = new Templates();
var audioContext = new window.AudioContext();

callbacks.onDOMReady.push(function () {
    templates.loadTemplatesFromDOM();
    templates.goTo('index');
});

var toolChain = {
    spool: null,
};

templates.on('index', (function () {
    var shaming = null;
    var handlers = {
        load: function () {
            shaming = templates.hookups['public-shaming'];
            templates.hookups['start-button'].addEventListener('click', start);
            setupWorker(gotStream, didNotGetStream);
        }, unload: function () {
            ;
        }
    };
    return handlers;
    function didNotGetStream() {
        shaming.classList.remove('hidden');
    }
    function start() {
        setupWorker(gotStream, didNotGetStream);
    }
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
})());

var player = new Player(140, 4, 4);
templates.on('player', (function () {
    var rawGridRow = null;
    var handlers = {
        load: function () {
            templates.hookups['record'].addEventListener('click', onRecordClick);
            templates.hookups['pad-grid'].addEventListener('click', onTogglePlaySample);
            templates.hookups['playpause'].addEventListener('click', onPlayPauseClick);
            templates.hookups['bpm'].value = player.bpm;
            templates.hookups['bpm'].addEventListener('input', updateBPM);
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
    function updateBPM() {
        player.bpm = parseInt(this.value);
    }
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
        var movement = previousEvent.pageX - event.pageX;
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
            bindInput(templates.hookups['name'], sample, 'name');
            bindInput(templates.hookups['pitch'], sample, 'pitch');
            bindInput(templates.hookups['gain'], sample, 'gain');
            bindInput(templates.hookups['filter[cutoff]'], sample.filter, 'frequency');
            bindInput(templates.hookups['filter[type]'], sample.filter, 'type');
            templates.hookups['play'].addEventListener('click', draw);
            sample.onchange = draw;

            templates.hookups['save'].addEventListener('click', save);
            templates.hookups['delete'].addEventListener('click', remove);
            templates.hookups['duplicate'].addEventListener('click', duplicate);

            draw();
        },
        unload: function () {
            sample.onchange = null;
        }
    };
    return handlers;
    function bindInput(element, object, property) {
        element.value = object[property];
        var handler = partialUpdater(object, property);
        element.addEventListener('input', handler);
        element.addEventListener('keyup', handler);
    }
    function partialUpdater(object, property) {
        return function () {
            object[property] = this.value;
        };
    }
    function draw() {
        sample.play(audioContext.destination);
    }
    function save() {
        templates.goTo('player');
    }
    function remove() {
        player.removeSample(sample.id);
        save();
    }
    function duplicate() {
        var clone = sample.clone();
        player.addSample(clone);
        save();
    }
})());
