
(function (sandbox) {
    function MyAnalysis() {
        var stringMap = {};
        var stringList = [];
        var stringCount = 0;
        var lastiid = -1;
        var lastsid = -1;

        var traceWriter = new sandbox.TraceWriter("trace.log")
        //var logs = [];

        function logEvent(str) {
            traceWriter.logToFile(str+"\n");
            //@todo dump and clear the logs array once its size exceeds some constant, say 1024
        }

        function getValue(v) {
            var type = typeof v;
            if ((type === 'object' || type === 'function') && v !== null) {
                var shadowObj = sandbox.smemory.getShadowObjectOfObject(v);
                return sandbox.smemory.getIDFromShadowObjectOrFrame(shadowObj);
            } else if (type === 'string') {
                return getStringIndex(v); // @todo: md5(v) if v.length > 32
            } else if (type === 'undefined') {
                return '0';
            } else {
                return v;
            }
        }

        function getType(v) {
            var type = typeof v;
            if ((type === 'object' || type === 'function') && v !== null) {
                return 'O';
            } else if (type === 'string') {
                return 'S';
            } else if (type === 'undefined') {
                return 'U';
            } else {
                return 'P';
            }
        }

        function getStringIndex(str) {
            if (typeof str !== "string") {
                throw new Error("getStringIndex should only be called for strings")
            }
            if (Object.prototype.hasOwnProperty.call(stringMap, str)) {
                return stringMap[str];
            } else {
                stringCount++;
                var stringIdx = -stringCount;
                stringMap[str] = stringIdx;
                stringList.push(str);
                return stringIdx;
            }
        }

        function getOffset(offset) {
            if (typeof offset === "number") {
                offset = offset + "";
            }
            return getStringIndex(offset);
            /* 
            TODO: Handle this separately:
            if (typeof str === "number" && str >= 0) {
                return str;
            }
            */
        }


        // Handle native functions that read objects in pre, since callbacks may modify the data itself
        this.invokeFunPre = function (iid, f, base, args, isConstructor, isMethod, functionIid) {
            lastiid = iid;
            lastsid = sandbox.sid;
            if (isMethod && Array.isArray(base)) {
                var arr, params;
                // Array methods can be called as a.foo(..) or Array.prototype.foo(a, ...)
                if (base === Array.prototype) {
                    arr = args[0];
                    params = Array.prototype.slice.call(args, 1);
                } else {
                    arr = base;
                    params = Array.prototype.slice.call(args, 0);
                }

                // Methods that (mostly) read the base array
                if (f === Array.prototype.concat || 
                    f === Array.prototype.entries ||
                    f === Array.prototype.every ||
                    f === Array.prototype.filter ||
                    f === Array.prototype.find ||      // may read partially, but is O(n) traversal
                    f === Array.prototype.findIndex || // ditto
                    f === Array.prototype.some ||      // ditto
                    f === Array.prototype.forEach ||
                    f === Array.prototype.include ||
                    f === Array.prototype.indexOf ||
                    f === Array.prototype.join ||
                    f === Array.prototype.filter ||
                    f === Array.prototype.lastIndexOf ||
                    f === Array.prototype.map ||
                    f === Array.prototype.reduce ||
                    f === Array.prototype.reduceRight ||
                    f === Array.prototype.reverse ||
                    f === Array.prototype.sort ||  
                    f === Array.prototype.toLocaleString ||
                    f === Array.prototype.toString ||
                    f === Array.prototype.values ) {
                    //this.readProp(iid, arr, "length");
                    this.readOwnProps(iid, arr);      
                }
            }
        };

        // Handle native functions that write objects in post, since they often deal with returned values
        this.invokeFun = function (iid, f, base, args, result, isConstructor, isMethod, functionIid) {
            if (isConstructor) {
                if (f === Array) {
                    //this.writeProp(iid, result, "length");
                    this.writeOwnProps(iid, result);
                } else if (f === Function) {
                    this.writeProp(iid, result, "name");
                    this.writeProp(iid, result, "length");   
                    this.writeProp(iid, result, "prototype");                  
                } 
            } else if (f === Array.from || f === Array.of) { 
                this.writeProp(iid, result, "length");
                this.writeOwnProps(iid, result);                
            } else if (isMethod && Array.isArray(base)) {
                var arr, params;
                // Array methods can be called as a.foo(..) or Array.prototype.foo(a, ...)
                if (base === Array.prototype) {
                    arr = args[0];
                    params = Array.prototype.slice.call(args, 1);
                } else {
                    arr = base;
                    params = Array.prototype.slice.call(args, 0);
                }
                // Methods that return a (mostly) written array
                if (f === Array.prototype.concat ||
                    f === Array.prototype.slice || 
                    f === Array.prototype.splice // Both writes base and result (base handled below) 
                    ) {
                    //this.writeProp(iid, result, "length");
                    this.writeOwnProps(iid, result);                    
                } else
                // Methods that (mostly) modify the base array
                if (f === Array.prototype.copyWithin ||
                    f === Array.prototype.fill ||    // Over-approximate partial fill
                    f === Array.prototype.reverse ||
                    f === Array.prototype.shift ||   // Values at all indexes are modified
                    f === Array.prototype.sort || 
                    f === Array.prototype.splice ||  // Change may be partial but is O(n) at most so over-approx
                    f === Array.prototype.unshift // Similar to shift
                    ) {
                    //this.writeProp(iid, arr, "length");
                    this.writeOwnProps(iid, arr);          
                } else 
                // Special handling for push/pop since they are so common
                if (f === Array.prototype.pop) {
                    //this.readProp(iid, arr, "length")
                    this.readProp(iid, arr, arr["length"])
                    this.writeProp(iid, arr, "length")
                } else if (f === Array.prototype.push) {
                    //this.writeProp(iid, arr, "length")
                    var idx = arr["length"] - 1, elems = params.length;
                    while (elems--) {
                        this.writeProp(iid, arr, idx--);
                    }
                }
            
            } else if (f === Object.defineProperty) {
                // TODO: init defined property
            } else if (f === Object.defineProperties) {
                // TODO: init defined properties
            }

            // TODO: Forward invocations of the type foo.call(x, y) to x.foo(y) 

        }


        this.getFieldPre = function (iid, base, offset, isComputed, isOpAssign, isMethodCall) {
            lastiid = iid;
            lastsid = sandbox.sid;
        };

        this.getField = function (iid, base, offset, val, isComputed, isOpAssign, isMethodCall) {
            var objectId = typeof base === "object" || typeof base === "function" ? 
                sandbox.smemory.getIDFromShadowObjectOrFrame(sandbox.smemory.getShadowObjectOfObject(base)) : 0;
            var shadowObj = sandbox.smemory.getShadowObject(base, offset, true);
            var ownerId = shadowObj.owner ? 
                sandbox.smemory.getIDFromShadowObjectOrFrame(shadowObj.owner) : 0;
            if (shadowObj.isProperty) {
                logEvent('G,' + sandbox.sid + "," + iid + "," + objectId + "," + ownerId + "," + getOffset(offset) + "," + getValue(val) + "," + getType(val));
            }
        };

        this.putFieldPre = function (iid, base, offset, val, isComputed, isOpAssign) {
            lastiid = iid;
            lastsid = sandbox.sid;
            var objectId = typeof base === "object" || typeof base === "function" ? 
                sandbox.smemory.getIDFromShadowObjectOrFrame(sandbox.smemory.getShadowObjectOfObject(base)) : 0;
            var shadowObj = sandbox.smemory.getShadowObject(base, offset, false);
            var ownerId = shadowObj.owner ? 
                sandbox.smemory.getIDFromShadowObjectOrFrame(shadowObj.owner) : 0;
            if (shadowObj.isProperty) {
                logEvent('P,' + sandbox.sid + "," + iid + "," + objectId + "," + ownerId + "," + getOffset(offset) + "," + getValue(val) + "," + getType(val));
            }
        };

        this.read = function (iid, name, val, isGlobal, isScriptLocal) {
            var shadowFrame = sandbox.smemory.getShadowFrame(name);
            logEvent('R,' + sandbox.sid + "," + iid + "," + sandbox.smemory.getIDFromShadowObjectOrFrame(shadowFrame) + "," + getStringIndex(name) + "," + getValue(val) + "," + getType(val));
        };

        this.write = function (iid, name, val, lhs, isGlobal, isScriptLocal) {
            var shadowFrame = sandbox.smemory.getShadowFrame(name);
            logEvent('W,' + sandbox.sid + "," + iid + "," + sandbox.smemory.getIDFromShadowObjectOrFrame(shadowFrame) + "," + getStringIndex(name) + "," + getValue(val) + "," + getType(val));
        };

        this.writeProp = function(iid, obj, prop) {
            this.putFieldPre(iid, obj, prop, obj[prop], false, false);
        }

        this.writeOwnProps = function(iid, obj) {
            for (prop in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                    this.writeProp(iid, obj, prop);
                }
            }
        }
        this.readProp = function(iid, obj, prop) {
            this.getField(iid, obj, prop, obj[prop], false, false);
        }

        this.readOwnProps = function(iid, obj) {
            for (prop in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                    this.readProp(iid, obj, prop);
                }
            }
        }

        this.literal = function(iid, lit, hasGetterSetter) {
            if (typeof lit === "object" && lit !== null) {
                var objectId = sandbox.smemory.getIDFromShadowObjectOrFrame(sandbox.smemory.getShadowObjectOfObject(lit));
                for (key in lit) {
                    // No hasOwnProperty check required since 'val' has jus been created as a literal
                    this.putFieldPre(iid, lit, key, lit[key], false, false);
                }
                if (Array.isArray(lit)) {
                    //this.writeProp(iid, lit, "length");
                }
            }
            if (typeof lit === "function") {                          
                this.writeProp(iid, lit, "name");          
                this.writeProp(iid, lit, "length");          
                this.writeProp(iid, lit, "prototype");
            }
        }

        this.declare = function(iid, name, val, isArgument, argumentIndex, isCatchParam) {
            if (isArgument) { 
                var shadowFrame = sandbox.smemory.getShadowFrame(name);
                var frameId = sandbox.smemory.getIDFromShadowObjectOrFrame(shadowFrame);
                // Log declarations of args with special symbol 'D' to indicate that the write is in the caller
                if (argumentIndex >= 0) { // Formal parameter
                    logEvent('D,' + sandbox.sid + "," + iid + "," + frameId + "," + getStringIndex(name) + "," + getValue(val) + "," + getType(val));
                } else { // arguments object
                    var shadowArguments = sandbox.smemory.getShadowObjectOfObject(val);
                    var shadowId = sandbox.smemory.getIDFromShadowObjectOrFrame(shadowArguments);
                    logEvent('D,' + sandbox.sid + "," + iid + "," + frameId + "," + getStringIndex("arguments") + "," + getValue(val) + "," + getType(val));                        
                    for (var i = 0; i < val.length; i++) {
                        var argValue = val[i];
                        logEvent('D,' + sandbox.sid + "," + iid + "," + shadowId + "," + getOffset(i) + "," + getValue(argValue) + "," + getType(argValue));                        
                    }
                }
            } else if (typeof val === "function") {
                var shadowFrame = sandbox.smemory.getShadowFrame(name);
                var frameId = sandbox.smemory.getIDFromShadowObjectOrFrame(shadowFrame);
                // Log this as a write, not a declaration because the write is in the callee and not the caller
                logEvent('W,' + sandbox.sid + "," + iid + "," + frameId + "," + getStringIndex(name) + "," + getValue(val) + "," + getType(val));
                // Initialize properties of function                
                this.writeProp(iid, val, "name");          
                this.writeProp(iid, val, "length");          
                this.writeProp(iid, val, "prototype");
            }
        }

        this.functionEnter = function (iid, f, dis, args) {
            var shadowFrame = sandbox.smemory.getShadowFrame('this');
            var frameId = sandbox.smemory.getIDFromShadowObjectOrFrame(shadowFrame);
            // First, log the function call
            logEvent('C,'+lastsid+","+lastiid+","+getValue(f)+","+frameId);
            // Then, declare the write of "this" before moving to declaring args and function declarations (see the 'declare' callback)
            logEvent('D,'+sandbox.sid+","+iid+"," + frameId + "," + getStringIndex("this") + "," + getValue(dis) + "," + getType(dis));
        };

        this.functionExit = function (iid, returnVal, wrappedExceptionVal) {
            logEvent('E,' + sandbox.sid + "," + iid + "," + getValue(returnVal) + "," + getType(returnVal));
        };

        this.endExecution = function () {
            traceWriter.stopTracing();
            var tw = new sandbox.TraceWriter("strings.json");
            tw.logToFile(JSON.stringify(stringList)+"\n");
            tw.stopTracing();
            tw = new sandbox.TraceWriter("smap.json");
            tw.logToFile(JSON.stringify(sandbox.smap)+"\n");
            tw.stopTracing();
        };

        this.runInstrumentedFunctionBody = function (iid, f, functionIid) {
            return false;
        };

        /**
         * onReady is useful if your analysis is running on node.js (i.e., via the direct.js or jalangi.js commands)
         * and needs to complete some asynchronous initialization before the instrumented program starts.  In such a
         * case, once the initialization is complete, invoke the cb function to start execution of the instrumented
         * program.
         *
         * Note that this callback is not useful in the browser, as Jalangi has no control over when the
         * instrumented program runs there.
         * @param cb
         */
        this.onReady = function (cb) {
            cb();
        };
    }

    sandbox.analysis = new MyAnalysis();
})(J$);


// node src/js/commands/jalangi.js --inlineIID --inlineSource --analysis src/js/sample_analyses/ChainedAnalyses.js --analysis src/js/runtime/SMemory.js --analysis src/js/sample_analyses/datatraces/TraceWriter.js --analysis src/js/sample_analyses/datatraces/LogData.js tests/octane/deltablue.js
