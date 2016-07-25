if (!window['require'] && window.document && !window['_nodularJS_']) {

    /**
     * @constructor
     */
    function _NodularJS_() {

        const that = this;

        Object.defineProperty(this, 'version', {
            enumerable: true,
            configurable: false,
            writable: false,
            value: '0.9 beta'
        });


        ////////////////
        // Private

        // Settings
        const asynchronous     = false; // Should be accessible from outside?
        const maxDeferTries    = 100;

        var fileModules        = {};

        // List of pending modules
        var pendingModules     = [];

        // Stack of currently running modules
        var runningModules     = [];

        // List of pending scripts
        var pendingScripts     = [];

        // Number of requested requires
        var requestedRequired  = 0;

        // Number of successfully executed requires
        var successfulRequired = 0;

        this.runningModule = null;

        var c = 0;

        // Status of a required module
        const ModuleStatus = {
            'NONE':          c++,
            'DOWNLOADING':   c++,
            'DOWNLOADED':    c++,
            'DOWNLOADERROR': c++,
            'PREPARING':     c++,
            'ABORTED':       c++,
            'SUCCESS':       c++
        }

        const ModuleStatusNONE          = ModuleStatus['NONE'];
        const ModuleStatusDOWNLOADING   = ModuleStatus['DOWNLOADING'];
        const ModuleStatusDOWNLOADED    = ModuleStatus['DOWNLOADED'];
        const ModuleStatusDOWNLOADERROR = ModuleStatus['DOWNLOADERROR'];
        const ModuleStatusPREPARING     = ModuleStatus['PREPARING'];
        const ModuleStatusABORTED       = ModuleStatus['ABORTED'];
        const ModuleStatusSUCCESS       = ModuleStatus['SUCCESS'];

        const scriptAbortionMessage = "Aborting and defering script";


        ////////////////
        // Public

        ////////////////
        // Settings
        this['pathPrefix']     = '';
        this['forceDownloads'] = false;

        // Log level:
        // 0: no log
        // 1: errors only
        // 2: script execution
        // 3: everything, but not the exports
        // 4: everything
        this['loglevel']       = 0;

        this['ModuleStatus'] = ModuleStatus;

        // This can be used to simulate randomised download reception
        this['downloadWithRandomDeferTime'] = false;


        // Used for console logs only
        function scriptName(script) {
            if (script) {
                return script.scriptName  ||
                       (script.tagName == 'SCRIPT' ? (script.id || 'SCRIPT TAG') : null) ||
                       (script.file ? script.file() : 'UNKNOWN SCRIPT');
            } else {
                return '(anonymous script)';
            }
        }

        // Remove anything starting from the last /
        function removeLastPathElement(path) {
            var i = path.lastIndexOf('/');
            return i < 1 ? ''
                         : path.substring(0, i);
        }

        // Process .. in paths and insert ./ at beginning, if not present
        // Ex: xx/yyy/../zzz results in ./xx/zzz
        function sanitizedPath(path) {
            var comps = path.split('/'),
                n = comps.length;
                res = [];
                i = n > 0 && comps[0] == '.' ? 1 : 0;
            while (i < n) {
                var comp = comps[i++];
                if (comp == '..') {
                    if (res.length && res[res.length - 1] !== '..') {
                        res.pop();
                        continue;
                    }
                }
                res.push(comp);
            }
            if (res.length == 1 || res[0] != '..' && res[0] != '.') {
                return './' + res.join('/');
            }
            return res.join('/');
        }

        // Hash a string. Found on http://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript-jquery
        // Used to gather script paths by hash for faster subsequent search
        function stringHash(str) {
            var hash = 0, i, chr, len;
            if (str.length === 0) return hash;
            for (i = 0, len = str.length; i < len; i++) {
                chr   = str.charCodeAt(i);
                hash  = ((hash << 5) - hash) + chr;
                hash |= 0; // Convert to 32bit integer
            }
            return hash;
        }

        const beginMagicString = '<!-- ___ HEADER __ -->\n\n';
        const endMagicString = '\n\n<!-- ___ FOOTER __ -->';
        function copiedAndPatchedScript(script) {
            var s = document.createElement('SCRIPT');

            // Copy attributes, if present
            script.type !== '' && (s.type = script.type);
            script.id   !== '' && (s.id   = script.id  );

            // Copy properties and code
            s.scriptName      = script.scriptName;
            s._requireIndex   = script._requireIndex;
            s.deferCount      = script.deferCount;
            if (script.patched) {
                s.innerHTML    = script.innerHTML;
                s.orgInnerHTML = script.orgInnerHTML;
            } else {
                s.orgInnerHTML = script.innerHTML;
                s.innerHTML = 'var __error__=false;try{\n\n'
                            + beginMagicString
                            + script.innerHTML
                            + endMagicString
                            + `\n\n}catch(e){__error__=true;throw e}finally{if (!__error__)window._nodularJS_.checkRunPendingCodeNeeded();window._nodularJS_.cleanScript();}`;
            }
            s.patched       = true;
            s.requiring     = script.requiring;

            for (var i=0, files = Object.keys(fileModules), n=files.length; i<n; i++) {
                fileModules[files[i]].requiredBy.replaceFirst(script, s);
            }

            return s;
        }

        const beginRegExp = new RegExp('^[\\s\\S]*' + beginMagicString);
        const endRegExp   = new RegExp(endMagicString + '[\\s\\S]*$');
        this['cleanScript'] = function() {
            var script = document.currentScript;
            script.innerHTML = script.innerHTML.replace(endRegExp, '').replace(beginRegExp, '');
            delete script.patched;
        }

        function modulesAreReady(modules) {
            for (var i=0, n=modules.length; i<n; i++) {
                if (!modules[i].isReady()) {
                    return false;
                }
            }
            return true;
        }

        // A script can execute if all its known required modules have been
        // successfully executed
        function scriptCanExecute(script) {
            if (script.requiresAll) {
                for (var i=0, files = Object.keys(fileModules), n=files.length; i<n; i++) {
                    if (!fileModules[files[i]].isReady()) return false;
                }
                return true;
            } else {
                return modulesAreReady(script.requiring.items);
            }
        }

        // A module can execute if all its known required modules have been
        // successfully executed
        function moduleCanExecute(module) {
            return modulesAreReady(module.requiring.items);
        }

        function checkRunPendingCode() {
            cancelRunningScriptsTimeout();

            // If any, execute downloaded source and return
            if (pendingModules.length) {
                for(;;) {
                    var module = null;
                    var pendingLen = pendingModules.length;
                    for (var i=0; i<pendingLen; i++) {
                        var testedModule = pendingModules[i];
                        if (moduleCanExecute(testedModule)) {
                            pendingModules.splice(i, 1);
                            module = testedModule;
                            break;
                        }
                    }
                    if (module) {
                        if (that['loglevel'] > 1) console.log('! Rerunning module ' + module.file());
                        module.execute();
                        return;
                    } else {
                        break;
                    }
                }
            }

            if (pendingScripts.length) {
                for(;;) {
                    var script = null;
                    var pendingLen = pendingScripts.length;
                    for (var i=0; i<pendingLen; i++) {
                        var testedScript = pendingScripts[i];
                        if (scriptCanExecute(testedScript)) {
                            pendingScripts.splice(i, 1);
                            script = testedScript;
                            break;
                        }
                    }
                    if (script) {
                        if (that['loglevel'] > 1) console.log('! Rerunning script ' + scriptName(script));
                        rescheduleScript(script);
                    } else {
                        break;
                    }
                }
            }
        };

        /**
         * @constructor
         */
        function InternalError(description) {
            this.description = description;
            this.isInternalError = true;
        }

        function tryDeferCurrentScript(info) {
            // document.currentScript can be null if called from timeout, for instance
            var currentScript = document.currentScript;

            if (!currentScript) {
                // This situation is not handled, as we have no way to defer that script
                throw new InternalError("Cancelling script");
            }

            currentScript.deferCount = currentScript.deferCount || 0;
            currentScript.deferCount++;

            if (currentScript.deferCount > maxDeferTries) {
                throw 'Max number of script defering reached (' + maxDeferTries + ')';
            }

            if (that['loglevel'] > 1) console.warn('! Deferring '+ scriptName(currentScript) + ' (requires ' + (info ? info.files : 'all files') + ')');

            if (that['loglevel'] > 2) console.log('Adding ' + scriptName(currentScript) + ' to pending scripts (' + pendingScripts.length + ')');

            var inserted = false;
            for (var i=0, len=pendingScripts.length; i<len; i++) {
                if (pendingScripts[i]._requireIndex > currentScript._requireIndex) {
                    pendingScripts.splice(i, 0, currentScript);
                    inserted = true;
                    break;
                }
            }
            if (!inserted) {
                pendingScripts.push(currentScript);
            }

            // Prevent firing of default error handler
            var onerror = window.onerror;
            window['onerror'] = function(message, source, lineno, colno, error) {
                window.onerror = onerror;
                if (message === scriptAbortionMessage || error === scriptAbortionMessage) return true;
                return error && error.isInternalError;
            };

            // Thow exception
            throw scriptAbortionMessage;
        }

        function rescheduleScript(script) {
            script.parentNode.removeChild(script);
            script = copiedAndPatchedScript(script);

            if (that['loglevel'] > 2) console.log('Adding ' + scriptName(script));
            document.body.appendChild(script);
            if (that['loglevel'] > 2) console.log('Added  ' + scriptName(script));
        };

        this.preload = function(files) {
            for (var i=0, n=files.length; i<n; i++) {
                var file = sanitizedPath(files[i]);
                if (!fileModules[file]) {
                    if (that['loglevel'] > 2) console.log('Preloading ' + file);
                    var module = new Module(file);
                    module.download(that['forceDownload']);
                }
            }
        }

        var runningScriptsTimeout = null;

        function cancelRunningScriptsTimeout() {
            if (runningScriptsTimeout) {
                clearTimeout(runningScriptsTimeout);
                runningScriptsTimeout = null;
            }
        }

        /////////////////////
        // Public functions

        // checkRunPendingCodeNeeded needs to be accessible from the script
        this['checkRunPendingCodeNeeded'] = function() {
            if (asynchronous) {
                if (!runningScriptsTimeout) {
                    runningScriptsTimeout = setTimeout(function() {
                        checkRunPendingCode();
                    }, 0);
                }
            } else {
                checkRunPendingCode();
            }
        };

        var currentRequireIndex = 0;
        var preloadWarningTimeout = null;
        this.require = function(files, forceDownload) {
            if (document.currentScript) {
                if (typeof document.currentScript._requireIndex === 'undefined') {
                    document.currentScript._requireIndex = currentRequireIndex++;
                    document.currentScript.requiring = new BasicOrderedSet();
                }
            }

            if (!files || !files.length) {
                // Require all modules
                if (that['loglevel'] > 2) console.log(scriptName(document.currentScript) + ' required ALL');
                if (document.currentScript) {
                    document.currentScript.requiresAll = true;
                }
                if (requestedRequired != successfulRequired) {
                    if (that['loglevel'] > 2) console.log(`${requestedRequired} requested, ${successfulRequired} ready, deferring...`);
                    // This will throw an exception and stop execution
                    tryDeferCurrentScript(null);
                }
                if (that['loglevel'] > 2) console.log(`${requestedRequired} requested, ${successfulRequired} ready, moving on...`);
                return;
            }

            var currentCode = null;
            var currentPath = '';
            if (document.currentScript) {
                currentCode = document.currentScript;
            } else {
                currentCode = that.runningModule;
                if (currentCode) {
                    currentPath = removeLastPathElement(currentCode.file());
                }
            }

            if (!currentCode) {
                throw "require shouldn't be used in anonymous code";
            }

            // Force array
            if (!Array.isArray(files)) {
                files = [files];
            }

            var deferReason = [];
            for (var i=0, n=files.length; i<n; i++) {
                var file = files[i];
                if (currentPath.length) {
                    file = currentPath + '/' + file;
                }
                file = sanitizedPath(file);
                if (that['loglevel'] > 2) console.log(scriptName(currentCode) + ' required ' + file);

                var module = fileModules[file];
                if (!module) {
                    module = new Module(file);
                    if (preloadWarningTimeout) {
                        clearTimeout(preloadWarningTimeout);
                    }
                    preloadWarningTimeout = setTimeout(function() {
                        var res = [];
                        for (var i=0, files = Object.keys(fileModules), n=files.length; i<n; i++) {
                            res.unshift(files[i]);
                        }
                        console.warn('Suggested preload code:\n_nodularJS_.preload(' + JSON.stringify(res) + ');');
                    }, 2000);
                }
                currentCode.requiring.add(module);
                module.requiredBy.add(currentCode);

                if (module.status < ModuleStatusDOWNLOADING) {
                    module.download(forceDownload);
                }

                if (module.status >= ModuleStatusSUCCESS) {
                    if (that['loglevel'] > 2) console.log('Already run successfully: ' + file);
                    if (n == 1) return module.exports;
                } else {
                    if (that['loglevel'] > 2) console.log('Still not run successfully: ' + file);
                    deferReason.push(file);
                }
            }
            if (deferReason.length) {
                tryDeferCurrentScript({files: deferReason});
            }
        }

        /**
         * @constructor
         */
        function BasicOrderedSet() {
            this.items = [];

            this.add = function(value) {
                for (var i=0, n=this.items.length; i<n; i++) {
                    if (value === this.items[i]) return;
                }
                this.items.push(value);
            }

            this.replaceFirst = function(v1, v2) {
                for (var i=0, n=this.items.length; i<n; i++) {
                    if (v1 === this.items[i]) {
                        this.items[i] = v2;
                        break;
                    }
                }
            }

            this.last   = function() {
                return this.items[this.items.length - 1];
            }
        }

        /**
         * @constructor
         */
        function Module(file) {
            var status = ModuleStatusNONE;

            Object.defineProperty(this, 'status', {
                enumerable: true,
                configurable: false,
                get: function() {
                    return status;
                },
                set: function(value) {
                    status = value;
                    this.onstatuschange && this.onstatuschange();
                }
            });

            var sourceCode = null;
            this.file = function() { return file; }
            this['sourceCode'] = function() { return sourceCode; }

            this.requiring  = new BasicOrderedSet();
            this.requiredBy = new BasicOrderedSet();

            this.requiredByChain = function() {
                if (this.requiredBy.items.length == 0) return '';

                var requiredBy = this.requiredBy.last();
                if (requiredBy.constructor === Module) {
                    return requiredBy.file() + ' ◀ ' + requiredBy.requiredByChain();
                }
                return scriptName(requiredBy);
            }

            this.setSourceCode = function(code) {
                sourceCode = code;
            }

            fileModules[file] = this;
        }

        Module.prototype.isReady = function() {
            return this.status >= ModuleStatusSUCCESS;
        }

        Module.prototype.src = function() {
            return `${window['_nodularJS_']['pathPrefix']}${this.file()}`.replace(/\/\.\//g, '/');
        }

        Module.prototype.runWrappedCode = function() {
            (function () {
                this['module'] = {'exports':{}};
                var moduleStore = this['module'];
                try {
                    eval('var module = moduleStore;that.runningModule=this;\n\n' + this['sourceCode']());
                    this.exports = moduleStore['exports'];
                } finally {
                    delete that.runningModule;
                }
                if (this['module'] !== moduleStore) throw "Error: module was replaced in required file ${this.file()}";
                if (that['loglevel'] > 1) {
                    if (typeof this['module'].exports !== 'undefined') console.log(`  -> ${this.file()} exports: ${typeof this['module'].exports}`);
                    if (that['loglevel'] > 3) console.log(`  -> exports: ${this['module'].exports}`);
                }
            }.bind(this))();
        }

        Module.prototype.executeCode = function() {
            this.status = ModuleStatusPREPARING;
            try {
                if (that['loglevel'] > 1) console.log(`>>> Executing ${this.file()}`);

                this.runWrappedCode();

            } catch(e) {
                if (e.isInternalError) {
                    if (that['loglevel'] > 1) console.warn(`<<< Aborted ${this.file()} (requires ${this.requiring.items.slice(-1)[0].file()})`);
                }
                this.status = ModuleStatusABORTED;
                throw e;
            }
            this.status = ModuleStatusSUCCESS;
        }

        Module.prototype.execute = function() {
            try {
                this.executeCode();
            } catch (e) {
                if (e.isInternalError) {
                    pendingModules.push(this);
                } else {
                    throw e;
                }
            }
        }

        Module.prototype.onstatuschange = function() {
            if (that['loglevel'] > 2) {
                var res = [];
                for (var i=0, files = Object.keys(fileModules), n=files.length; i<n; i++) {
                    res.push(fileModules[files[i]]);
                }
                console.error('Modules: ' + JSON.stringify(res, null, '\t'));
            }
            switch (this.status) {
                case ModuleStatusDOWNLOADING:
                    requestedRequired++;
                    break;
                case ModuleStatusPREPARING:
                    runningModules.push(this.file());
                    break;
                case ModuleStatusABORTED:
                    runningModules.pop();
                    break;
                case ModuleStatusSUCCESS:
                    runningModules.pop();
                    successfulRequired++;
                    that['checkRunPendingCodeNeeded']();
                    break;
            }
            if (that['onmodulestatuschange']) {
                that['onmodulestatuschange'](this);
            }
        }

        Module.prototype.download =  function(forceDownload) {
            this.status = ModuleStatusDOWNLOADING;
            var req = new XMLHttpRequest();
            req.module = this;
            req.onreadystatechange = function() {
                if (req.readyState === 4) {
                    var module = this.module;
                    if (req.status === 200) {
                        module.setSourceCode(this.responseText);
                        if (that['loglevel'] > 1) console.log('Received ' + module.file());
                        module.status = ModuleStatusDOWNLOADED;
                        module.execute();
                    } else {
                        module.status = ModuleStatusDOWNLOADERROR;
                        throw new URIError(module.src() + ' not accessible, status: ' + req.status + ', (required by ' + module.requiredByChain() + ')');
                    }
                }
            };
            var src = this.src();
            req.open("GET", src, true);
            if (that['forceDownloads'] || forceDownload) {
                req.setRequestHeader('Cache-Control', 'no-cache');
                req.setRequestHeader('If-None-Match', '_A_DUMMY_ETAG');
                req.channel && (req.channel.loadFlags |= Components['interfaces']['nsIRequest']['LOAD_BYPASS_CACHE']);
                /*
                // Add some random to the source to trick browser cache
                if (src.indexOf('?') > -1) {
                    src += '&' + Math.random();
                } else {
                    src += '?' + Math.random();
                }
                */
            }
            if (that['downloadWithRandomDeferTime']) {
                setTimeout(function(){
                    req.send(null);
                }, 2000 * Math.random());
            } else {
                req.send(null);
            }
        }

        Module.prototype.statusString = function() {
            switch (this.status) {
                case ModuleStatusNONE          : return 'None';
                case ModuleStatusDOWNLOADING   : return 'Downloading';
                case ModuleStatusDOWNLOADED    : return 'Downloading';
                case ModuleStatusDOWNLOADERROR : return 'Download error';
                case ModuleStatusPREPARING     : return 'Preparing';
                case ModuleStatusABORTED       : return 'Aborted';
                case ModuleStatusSUCCESS       : return 'Success';
                default: return 'Invalid status';
            }
        }

        Module.prototype.toJSON = function(a, b, c) {
            return `{file: ${this.file()}, status: ${this.statusString()}}`;
        }

    };

    // To still work after Closure Compiler does its job
    window['_nodularJS_'] = new _NodularJS_();
    window['require'] = window['_nodularJS_'].require;
}
