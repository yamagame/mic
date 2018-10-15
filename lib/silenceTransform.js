var Transform = require('stream').Transform;
var util = require("util");

function IsSilence(options) {
  var that = this;
  if (options && options.debug) {
    that.debug = options.debug;
    delete options.debug;
  }
  Transform.call(that, options);
  var consecSilenceCount = 0;
  var numSilenceFramesExitThresh = 0;

  that.silence_state = 'idle';
  that.speech_state = 'idle';

  // マイクの音声認識の閾値の初期設定
  that.silent_threshold = 2000;

  // マイクの感度(%)
  that.mic_level = 1;

  // 無音状態判断パラメータ
  that.silenceDelayBlockLength = 300;

  // マイクの音声認識の閾値を変更する
  that.changeSilentThreshold = function changeSilentThreshold(threshold) {
    const value = Number(threshold);
    if (value > 0) {
      this.silent_threshold = value;
    }
    return;
  }

  //パラメータの変更
  that.changeParameters = function changeParameters(params) {
    if ('threshold' in params) {
      const value = Number(params.threshold);
      that.silent_threshold = value;
      if (that.silent_threshold < 0) that.silent_threshold = 0;
    }
    if ('level' in params) {
      const value = Number(params.level);
      that.mic_level = value / 100;
      if (that.mic_level < 0) that.mic_level = 0;
      if (that.mic_level > 1) that.mic_level = 1;
    }
    if ('delay' in params) {
      const value = parseInt(Number(params.delay));
      that.silenceDelayBlockLength = value;
      if (that.silenceDelayBlockLength < 0) that.silenceDelayBlockLength = 0;
    }
    return;
  }

  that.getNumSilenceFramesExitThresh = function getNumSilenceFramesExitThresh() {
    return numSilenceFramesExitThresh;
  };

  that.getConsecSilenceCount = function getConsecSilenceCount() {
    return consecSilenceCount;
  };

  that.setNumSilenceFramesExitThresh = function setNumSilenceFramesExitThresh(numFrames) {
    return;
  };

  that.changeState = function changeState(state) {
    if (state === 'start') {
      numSilenceFramesExitThresh = 1;
    } else {
      numSilenceFramesExitThresh = 0;
    }
    return;
  };

  that.incrConsecSilenceCount = function incrConsecSilenceCount() {
    return 0;
  };

  that.incrConsecSilenceCount_ = function incrConsecSilenceCount_() {
    consecSilenceCount++;
    return consecSilenceCount;
  };

  that.resetConsecSilenceCount = function resetConsecSilenceCount() {
    consecSilenceCount = 0;
    return;
  };
};
util.inherits(IsSilence, Transform);

IsSilence.prototype._transform = function (chunk, encoding, callback) {
  var self = this;

  function processOne(chunk) {
    var i;
    var speechSample;
    var silenceSampleCount = 0;
    var debug = self.debug;
    var consecutiveSilence = self.getConsecSilenceCount();
    var changeState = self.changeState;
    var incrementConsecSilence = self.incrConsecSilenceCount_
    var resetConsecSilence = self.resetConsecSilenceCount;
    var sign;
    var hi;
    var lo;
    var silenceCheck = true;

    if (self.silenceDelayBlockLength) {
      for (i = 0; i < chunk.length; i = i + 2) {
        var sign = 1;
        var hi = chunk[i + 1];
        if (hi > 128) {
          sign = -1;
          hi = 256 - hi;
        } else {
          sign = 1;
        }
        speechSample = parseInt(((hi << 8) + chunk[i]) * self.mic_level);
        chunk[i] = speechSample & 0xff;
        var lo = ((speechSample >> 8) & 0xff);
        chunk[i + 1] = (sign < 0 ? (256 - lo) : (lo));
        if (silenceCheck) {
          if (Math.abs(speechSample) > self.silent_threshold) {
            if (debug) {
              console.log("Found speech block");
            }
            if (self.silence_state !== 'speech') {
              self.silence_state = 'speech';
              self.emit('speech');
            }
            if (self.speech_state !== 'speech') {
              self.speech_state = 'speech';
              self.emit('speech-start');
              changeState('start');
            }
            resetConsecSilence();
            silenceCheck = false;
          } else {
            silenceSampleCount++;
          }
        }
      }
      if (silenceSampleCount == chunk.length / 2) {
        consecutiveSilence = incrementConsecSilence();
        if (debug) {
          console.log("Found silence block: %d of %d", consecutiveSilence, self.silenceDelayBlockLength);
        }
        if (self.silence_state !== 'silence') {
          self.silence_state = 'silence';
          self.emit('silence');
        }
        if (consecutiveSilence === self.silenceDelayBlockLength) {
          if (self.speech_state !== 'idle') {
            self.speech_state = 'idle';
            self.emit('speech-stop');
            changeState('stop');
          }
          resetConsecSilence();
        }
      }
    }

    self.push(chunk);
  }
  if (chunk.length < 100) {
    processOne(chunk);
  } else {
    for (var i = 0; i < chunk.length; i += 100) {
      if (i + 100 >= chunk.length) {
        processOne(chunk.slice(i, chunk.length))
      } else {
        processOne(chunk.slice(i, i + 100))
      }
    }
  }
  callback();
};

module.exports = IsSilence;