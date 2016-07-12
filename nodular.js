if (!window['require'] && window.document && !window['_nodeJSCompat_']) {

    /**
     * @constructor
     */
    function _NodeJSCompat_() {

        const that = this;

        Object.defineProperty(this, 'version', {
            enumerable: true,
            configurable: false,
            writable: false,
            value: '0.9 beta'
        });

        ////////////////
        // Public

        // Settings
        this['pathPrefix']     = '';
        this['forceDownloads'] = false;

        // Modules must have a global scope for reuse by other scripts
        this.modules           = {};


        ////////////////
        // Private

        // Settings
        const asynchronous     = false; // Should be accessible from outside?

        // Log level:
        // 0: no log
        // 1: errors only
        // 2: script execution
        // 3: everything, but not the exports
        // 4: everything
        var loglevel           = 0;

        // Hash table, for fast script lookup
        var requires           = {};

        // List of pending modules
        var pendingModules     = [];

        // List of pending scripts
        var pendingScripts     = [];

        // Stack of currently running scripts
        var runningScripts     = [];

        // Number of requested requires
        var requestedRequired  = 0;

        // Number of successfully executed requires
        var successfulRequired = 0;

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

        this['ModuleStatus'] = ModuleStatus;

        statusStr = {};
        statusStr[ModuleStatus['NONE']]          = 'None';
        statusStr[ModuleStatus['DOWNLOADING']]   = 'Downloading';
        statusStr[ModuleStatus['DOWNLOADED']]    = 'Downloaded';
        statusStr[ModuleStatus['DOWNLOADERROR']] = 'Download error';
        statusStr[ModuleStatus['PREPARING']]     = 'Preparing';
        statusStr[ModuleStatus['ABORTED']]       = 'Aborted';
        statusStr[ModuleStatus['SUCCESS']]       = 'Success';

        const scriptAbortionMessage = "Aborting and defering script";


        // Used for debug logs only
        function scriptName(script) {
            if (script) {
                return script.scriptName             ||
                       script.orgfile                ||
                       (script.tagName == 'SCRIPT' ? (script.id || 'SCRIPT TAG') : null) ||
                       script
                       ;
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
            if (res.length == 1 || res[0] != '..') {
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

        function insertionInfo(file) {
            var key = stringHash(file).toString();
            var required = requires[key];
            if (!required) {
                required = [];
                requires[key] = required;
            }
            for (var i=0, len=required.length; i<len; i++) {
                if (required[i] === file) {
                    return {key: key, index: i, file: file};
                }
            }
            return {key: key, index: -1, file: file};
        }

        function moduleID(file) {
            var info = insertionInfo(file);
            return `${info.key}_${info.index}`;
        }
        const beginMagicString = '<!-- ___ HEADER __ -->\n\n';
        const endMagicString = '\n\n<!-- ___ FOOTER __ -->';
        function copiedAndPatchedScript(script) {
            var s = document.createElement('SCRIPT');

            if (script.type) {
                s.type = script.type;
            }
            s.orgfile       = script.orgfile;
            s.scriptName    = script.scriptName;
            s._requireIndex = script._requireIndex;
            if (script.patched) {
                s.innerHTML    = script.innerHTML;
                s.orgInnerHTML = script.orgInnerHTML;
            } else {
                s.orgInnerHTML = script.innerHTML;
                s.innerHTML = 'var __error__=false;try{\n\n'
                            + beginMagicString
                            + script.innerHTML
                            + endMagicString
                            + `\n\n}catch(e){__error__=true;throw e}finally{if (!__error__)window._nodularJS_.checkRunPendingScriptsNeeded();window._nodularJS_.cleanScript();}`;
            }
            s.patched       = true;
            s.id            = script.id;

            for (key in that.modules) {
                var module = that.modules[key];

                var requiredBy = module.requiredBy(),
                    n = requiredBy.length;
                    for (var i=0; i<n; i++) {
                        if (requiredBy[i] === script) {
                            requiredBy[i] = s;
                            break;
                        }
                    }
            }

            return s;
        }

        this['cleanScript'] = function() {
            var script = document.currentScript;
            script.innerHTML = script.innerHTML.replace(new RegExp(endMagicString + '[\\s\\S]*$'), '').replace(new RegExp('^[\\s\\S]*' + beginMagicString), '');
            delete script.patched;
        }

        function checkRunPendingScripts() {
            cancelRunningScriptsTimeout();

            // If any, execute downloaded source and return
            if (pendingModules.length) {
                var module = pendingModules.pop();
                module.execute();
                return;
            }

            var pendingLen = pendingScripts.length;
            if (pendingLen) {
                /*
                if (loglevel > 2) console.log('!!! Still pending: ' + pendingLen + ' script' + (pendingLen > 1 ? 's' : ''));
                var scripts = [];
                window['_nodeJSCompat_'].pendingScripts.forEach(function(item) {
                    scripts.push(scriptName(item) + '(' + (item._requireIndex) + ')');
                });
                if (loglevel > 2) console.log('( ' + scripts.join(', ') + ' )');
                //*/

                var script = pendingScripts.pop();
                if (loglevel > 1) console.log('! Rerunning script ' + scriptName(script));
                rescheduleScript(script);
            } else {
                if (loglevel > 2) console.log('!!! No pending script');
            }
        };

        /**
         * @constructor
         */
        function InternalError(description) {
            this.description = description;
            this.isInternalError = true;
        }

        function tryDeferCurrentScript() {
            // document.currentScript can be null if called from timeout, for instance
            var currentScript = document.currentScript;

            if (!currentScript) {
                // This situation is not handled, as we have no way to defer that script
                throw new InternalError("Cancelling script");
            }

            if (loglevel > 2) console.log('Adding ' + scriptName(currentScript) + ' to pending scripts (' + pendingScripts.length + ')');
            var inserted = false;
            for (var i=0, len=pendingScripts.length; i<len; i++) {
                var other = pendingScripts[i];
                if (loglevel > 2) console.log(other._requireIndex);
                if (other._requireIndex < currentScript._requireIndex) {
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

            if (loglevel > 2) console.log('Adding ' + scriptName(script));
            document.body.appendChild(script);
            if (loglevel > 2) console.log('Added  ' + scriptName(script));
        };

        function requireOneFile(info, currentScript, forceDownload) {
            requires[info.key].push(info.file);

            var module = new Module(info.file);
            module.addRequiredBy(currentScript);
            that.modules[module.ID()] = module;
            module.download(forceDownload);

            if (document.currentScript) {
                tryDeferCurrentScript();
            } else {
                throw new InternalError(`${info.file} was required in an anonymous script`);
            }
        }

        function requireAll() {
            if (requestedRequired != successfulRequired) {
                if (loglevel > 2) console.log(`${requestedRequired} requested, ${successfulRequired} ready, deferring...`);
                tryDeferCurrentScript();
            }
            if (loglevel > 2) console.log(`${requestedRequired} requested, ${successfulRequired} ready, moving on...`);
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

        // checkRunPendingScriptsNeeded needs to be accessible from the script
        this['checkRunPendingScriptsNeeded'] = function() {
            if (asynchronous) {
                if (!runningScriptsTimeout) {
                    runningScriptsTimeout = setTimeout(function() {
                        checkRunPendingScripts();
                    }, 0);
                }
            } else {
                checkRunPendingScripts();
            }
        };

        var currentRequireIndex = 0;
        function setRequireIndex(script) {
            if (typeof script._requireIndex == 'undefined') {
                script._requireIndex = currentRequireIndex++;
            }
        }

        this.getModule = function(file) {
            file = sanitizedPath(file);
            var info = insertionInfo(file);
            if (info.index == -1) {
                return null;
            } else {
                return that.modules[moduleID(file)];
            }
        }

        this.require = function(file, forceDownload, test) {
            if (document.currentScript) {
                setRequireIndex(document.currentScript);
            }

            if (!file || !file.length) {
                if (loglevel > 2) console.log(scriptName(currentScript) + ' required ALL');
                requireAll();
                return;
            }

            var currentScript;
            if (document.currentScript) {
                currentScript = document.currentScript;
            } else {
                currentScript = runningScripts[runningScripts.length - 1];
                if (currentScript) {
                    var currentPath = removeLastPathElement(currentScript);
                    if (currentPath.length) {
                        file = currentPath + '/' + file;
                    }
                }
            }

            file = sanitizedPath(file);
            if (loglevel > 2) console.log(scriptName(currentScript) + ' required ' + file);

            var requestingModuleID = moduleID(scriptName(currentScript));

            var requestingModule = that.modules[requestingModuleID];
            if (requestingModule) {
                requestingModule.addRequiring(file);
            }

            var info = insertionInfo(file);
            if (info.index == -1) {
                if (loglevel > 2) console.log('Never heard of ' + file + ' (currently in ' + scriptName(currentScript) + ')');
                requireOneFile(info, currentScript, forceDownload);
            } else {
                var module = that.modules[moduleID(file)];
                if (module && module.status >= ModuleStatus['SUCCESS']) {
                    if (loglevel > 2) console.log('Already run successfully: ' + file);
                    module.addRequiredBy(currentScript);
                    return module.exports;
                } else {
                    if (loglevel > 2) console.log('Still not run successfully: ' + file);
                    tryDeferCurrentScript();
                }
            }
        }

        /**
         * @constructor
         */
        function Module(file) {
            var requiredBy = [];
            var sourceCode = null;
            var ID = moduleID(file);
            var requiring = [];

            this.status = ModuleStatus['NONE'];

            this.ID   = function() { return ID;   }
            this.file = function() { return file; }
            this.requiredBy    = function() { return requiredBy;   }
            this.requiring     = function() { return requiring;    }
            this['sourceCode'] = function() { return sourceCode; }

            this.requiredByChain = function() {
                if (requiredBy.length == 0) return '';

                var requiredBys = requiredBy[requiredBy.length - 1];
                var module = that.modules[moduleID(requiredBys)];
                if (module) return module.file() + ' <- ' + module.requiredByChain();
                return scriptName(requiredBys);
            }

            this.addRequiredBy = function(by) {
                for (var i=0, n=requiredBy.length; i<n; i++) {
                    if (requiredBy[i] === by) return;
                }
                requiredBy.push(by);
            }

            this.addRequiring = function(by) {
                requiring.push(by);
            }

            this.setSourceCode = function(code) {
                sourceCode = code;
            }

            this.setStatus = function(astatus) {
                this.status = astatus;
                if (this.onstatuschange) {
                    this.onstatuschange();
                }
            }
        }

        Module.prototype.src = function() {
            return `${window['_nodeJSCompat_']['pathPrefix']}${this.file()}`;
        }

        Module.prototype.runWrappedCode = function() {
            (function () {
                this['module'] = {};
                var moduleStore = this['module'];
                var error = true;
                try {
                    eval('var module = this["module"];\n\n' + this['sourceCode']());
                    error = false;
                    this.exports = this['module']['exports'];
                } finally {}
                if (this['module'] !== moduleStore) throw "Error: module was replaced in required file ${this.file()}";
                if (loglevel > 1) {
                    if (typeof this['module'].exports !== 'undefined') console.log(`  -> ${this.file()} exports: ${typeof this['module'].exports}`);
                    if (loglevel > 3) console.log(`  -> exports: ${this['module'].exports}`);
                    console.log(`<<< ${this.file()} ran successfully`);
                }
            }.bind(this))();
        }

        Module.prototype.executeCode = function() {
            this.setStatus(ModuleStatus['PREPARING']);
            try {
                if (loglevel > 1) console.log(`>>> Executing ${this.file()}`);

                this.runWrappedCode();

            } catch(e) {
                if (e.isInternalError) {
                    if (loglevel > 1) console.log(`<<< Aborted ${this.file()}, required ${this.requiring().slice(-1)[0]}`);
                }
                this.setStatus(ModuleStatus['ABORTED']);
                throw e;
            } finally {
            };
            this.setStatus(ModuleStatus['SUCCESS']);
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

        Module.prototype.execute_ = function() {
            var script = document.createElement('SCRIPT');
            script.innerHTML = '';
        }


        Module.prototype.onstatuschange = function() {
            if (loglevel > 2) console.error('Modules: ' + JSON.stringify(that.modules, null, '\t'));
            switch (this.status) {
                case ModuleStatus['DOWNLOADING']:
                    requestedRequired++;
                    break;
                case ModuleStatus['PREPARING']:
                    runningScripts.push(this.file());
                    break;
                case ModuleStatus['ABORTED']:
                    runningScripts.pop();
                    break;
                case ModuleStatus['SUCCESS']:
                    runningScripts.pop();
                    successfulRequired++;
                    that['checkRunPendingScriptsNeeded']();
                    break;
            }
            if (that['onmodulestatuschange']) {
                that['onmodulestatuschange'](this);
            }
        }

        Module.prototype.download =  function(forceDownload) {
            this.setStatus(ModuleStatus['DOWNLOADING']);
            var req = new XMLHttpRequest();
            req.module = this;
            req.onreadystatechange = function() {
                if (req.readyState === 4) {
                    var module = this.module;
                    if (req.status === 200) {
                        module.setSourceCode(this.responseText);
                        module.setStatus(ModuleStatus['DOWNLOADED']);
                        module.execute();
                    } else {
                        module.setStatus(ModuleStatus['DOWNLOADERROR']);
                        throw new URIError(module.src() + ' not accessible, status: ' + req.status + ', (required by ' + module.requiredByChain() + ')');
                    }
                }
            };
            var src = this.src();
            if (that['forceDownloads'] || forceDownload) {
                // Add some random to the source to trick browser cache
                if (src.indexOf('?') > -1) {
                    src += '&' + Math.random();
                } else {
                    src += '?' + Math.random();
                }
            }
            req.open("GET", src, true);
            req.send(null);
        }

        Module.prototype.toJSON = function(a, b, c) {
            return `{file: ${this.file()}, status: ${statusStr[this.status]}}`;
        }

    };

    // To still work after Closure Compiler does its job
    window['_nodeJSCompat_'] = new _NodeJSCompat_();
    window['require'] = window['_nodeJSCompat_'].require;
}
