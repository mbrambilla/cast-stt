// Resources:
// https://developers.google.com/web/updates/2013/01/Voice-Driven-Web-Apps-Introduction-to-the-Web-Speech-API
// https://github.com/GoogleChrome/webplatform-samples/blob/master/webspeechdemo/webspeechdemo.html
// https://github.com/zenorocha/voice-elements/

(function($) {
    'use strict';

    var STT_SUPPORT = false;
    var STT_RECOGNITION = null;

    $(function() {
        var SpeechRecognition = window.SpeechRecognition ||
            window.webkitSpeechRecognition ||
            window.mozSpeechRecognition ||
            window.msSpeechRecognition ||
            window.oSpeechRecognition;

        if (SpeechRecognition !== undefined) {
            STT_SUPPORT = true;
            STT_RECOGNITION = SpeechRecognition;
        } else {
            console.warn('SpeechRecognition is not supported by this browser.');
            $(document.body).trigger('nosupport.cast.stt');
        }
    });

    // ====================

    var CAST_STT = function(element, options) {
        this.$element = $(element);
        this.$target = null;
        this.instance = null;
        this.isInput = false;

        this.recognition = null;
        this.recognizing = false;

        this.settings = $.extend({}, CAST_STT.DEFAULTS, this.$element.data(), options);

        this._init();
    };

    CAST_STT.DEFAULTS = {
        target: null,
        continuous: true,   // SpeechRecognition.continuous
        interim: true       // SpeechRecognition.interimResults
    };

    CAST_STT.prototype = {
        _init : function() {
            var $selfRef = this;

            var selector = this.$element.data('target');
            this.$target = $(selector);

            var nodeName = this.$target[0].nodeName.toLowerCase();
            this.isInput = /^(input|textarea)$/.test(nodeName);

            this.instance = this._getID(this.$element, 'cast-stt');

            this.enable();

            // Catch modal close
            this.$element.closest('.modal')
                .on('beforeHide.cfw.modal', function(e) {
                    if (e.isDefaultPrevented()) { return; }
                    $selfRef.end();
                });

            // Bind callbacks to handle user interaction
            // Thottle them to reduce workload
            if (this.isInput) {
                this.$target.on('keyup.cast.stt', this._throttle($.proxy(this.update, this), 250));
            }
            $(window).on('resize.cast.stt' + this.instance, this._throttle($.proxy(this.update, this), 250));

            this.$element.trigger('init.cast.stt');
        },

        start : function() {
            this._bindAPI();
            this.recognition.start();
        },

        stop : function() {
            this._unbindAPI();
        },

        enable : function() {
            var $selfRef = this;
            this.$element
                .removeAttr('aria-disabled')
                .removeClass('disabled')
                .addClass('enabled')
                .off('click.cast.stt')
                .on('click.cast.stt', function(e) {
                    e.preventDefault();
                    if ($selfRef.$element.not('.disabled')) {
                        if ($selfRef.recognizing) {
                            $selfRef.stop();
                        } else {
                            $selfRef.start();
                        }
                    }
                });
            this.$element.trigger('ready.cast.stt');
        },

        disable : function() {
            this._unbindAPI();
            this.$element
                .attr('aria-disabled', true)
                .removeClass('enabled')
                .addClass('disabled');
        },

        update : function() {
            this._resetScrollbar();
            this._setScrollbar();
        },

        _checkScrollbar : function() {
            if (this.$target[0].clientHeight < this.$target[0].scrollHeight) {
                return true;
            }
            return false;
        },

        _measureScrollbar : function() {
            var $body = $(document.body);
            var scrollDiv = document.createElement('div');
            scrollDiv.className = 'stt-scrollbar-measure';
            $body.append(scrollDiv);
            var scrollbarWidth = scrollDiv.getBoundingClientRect().width - scrollDiv.clientWidth;
            $body[0].removeChild(scrollDiv);
            return scrollbarWidth;
        },

        _setScrollbar : function() {
            if (this._checkScrollbar()) {
                var scrollbarWidth = this._measureScrollbar();
                this.$element.data('cast.pos-right', this.$element[0].style.right || '');
                var pos = parseFloat(this.$element.css('right') || 0);
                this.$element.css('right', pos + scrollbarWidth);
            }
        },

        _resetScrollbar : function() {
            var pos = this.$element.data('cast.pos-right');
            if (typeof pos !== undefined) {
                this.$element.css('right', pos);
                this.$element.removeData('cast.pos-right');
            }
        },

        _bindAPI : function() {
            var $selfRef = this;

            var final_transcript = '';
            var ignore_onend = false;
            var start_timestamp;

            var outputMethod = this.isInput ? 'val' : 'text';
            var origTxt = this.$target[outputMethod]();

            this.recognition = new STT_RECOGNITION();
            this.recognition.continuous = this.settings.continuous;
            this.recognition.interimResults = this.settings.interim;

            this.recognition.onstart = function() {
                $selfRef.recognizing = true;
                if ($selfRef.isInput) {
                    $selfRef.$target.prop('readonly', true);
                }
                $selfRef.$element
                    .addClass('active')
                    .attr('aria-pressed', true)
                    .on('result.cast.stt', $selfRef._throttle($.proxy($selfRef.update, $selfRef), 250));

                // Speech recognition ready
                $selfRef.$element.trigger('start.cast.stt');
            };

            this.recognition.onerror = function(event) {
                if (event.error == 'no-speech') {
                    // No speech was detected
                    $selfRef.$element.trigger('nospeech.cast.stt');
                    ignore_onend = true;
                }
                if (event.error == 'audio-capture') {
                    // Microphone not found
                    $selfRef.$element.trigger('nomic.cast.stt');
                    ignore_onend = true;
                }
                if (event.error == 'not-allowed') {
                    if (event.timeStamp - start_timestamp < 100) {
                        // Microphone access is blocked
                        $selfRef.$element.trigger('blocked.cast.stt');
                    } else {
                        // Microphone access was denied
                        $selfRef.$element.trigger('denied.cast.stt');
                    }
                    ignore_onend = true;
                }
            };

            this.recognition.onend = function() {
                $selfRef.recognizing = false;
                if ($selfRef.isInput) {
                    $selfRef.$target.prop('readonly', false);
                }
                $selfRef.$element
                    .removeClass('active')
                    .attr('aria-pressed', false);
                if (ignore_onend) {
                    return;
                }
                $selfRef.$element.trigger('end.cast.stt');
                if (!final_transcript) {
                    $selfRef.$element.trigger('ready.cast.stt');
                    return;
                }
            };

            this.recognition.onresult = function(event) {
                function capitalize(s) {
                    var first_char = /\S/;
                    return s.replace(first_char, function(m) { return m.toUpperCase(); });
                }

                function linebreak(s) {
                    if (!$selfRef.isInput) {
                        var two_line = /\n\n/g;
                        var one_line = /\n/g;
                        return s.replace(two_line, '<p></p>').replace(one_line, '<br>');
                    }
                    return s;
                }

                var interim_transcript = '';
                for (var i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        final_transcript += event.results[i][0].transcript;
                    } else {
                        interim_transcript += event.results[i][0].transcript;
                    }
                }
                final_transcript = capitalize(final_transcript);

                var output = origTxt
                    + linebreak(final_transcript)
                    + linebreak(interim_transcript);
                $selfRef.$target[outputMethod](output);
                $selfRef.$element.trigger('result.cast.stt');
            };
        },

        _unbindAPI : function() {
            if( this.recognition) {
                this.recognition.stop();
                this.recognition = null;
            }
            this.$target.off('result.cast.stt');
        },

        dispose : function() {
            this._unbindAPI();
            $(window).off('.cast.stt' + this.instance);
            this.$target.off('.cast.stt');
            this.$element
                .off('.cast.stt')
                .removeClass('enabled disabled active')
                .removeData('cast.stt');

            this.$element = null;
            this.$target = null;
            this.instance = null;
            this.isInput = null;
            this.recognition = null;
            this.recognizing = null;
            this.settings = null;
        },

        _getID : function($node, prefix) {
            var nodeID = $node.attr('id');
            if (nodeID === undefined) {
                do nodeID = prefix + '-' + ~~(Math.random() * 1000000);
                while (document.getElementById(nodeID));
                $node.attr('id', nodeID);
            }
            return nodeID;
        },

        _throttle : function(fn, threshhold, scope) {
            /* From: http://remysharp.com/2010/07/21/throttling-function-calls/ */
            threshhold || (threshhold = 250);
            var last;
            var deferTimer;
            return function() {
                var context = scope || this;

                var now = +new Date();
                var args = arguments;
                if (last && now < last + threshhold) {
                    // hold on to it
                    clearTimeout(deferTimer);
                    deferTimer = setTimeout(function() {
                        last = now;
                        fn.apply(context, args);
                    }, threshhold);
                } else {
                    last = now;
                    fn.apply(context, args);
                }
            };
        }
    };

    function Plugin(option) {
        if (!STT_SUPPORT) { return; } // Bail if not supported

        var args = [].splice.call(arguments, 1);
        return this.each(function() {
            var $this = $(this);
            var data = $this.data('cast.stt');
            var options = typeof option === 'object' && option;

            if (!data) {
                $this.data('cast.stt', (data = new CAST_STT(this, options)));
            }
            if (typeof option === 'string') {
                data[option].apply(data, args);
            }
        });
    }

    $.fn.CAST_STT = Plugin;
    $.fn.CFW_Scrollspy.Constructor = CAST_STT;

    $(window).ready(function() {
        $('[data-cast="stt"]').each(function() {
            $(this).CAST_STT();
        });
    });

})(jQuery);
