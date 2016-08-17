var fs = require('fs');
var path = require('path');

(function (sandbox) {

    function loc(iid) {
      var sid = sandbox.sid;
      var fileName = sandbox.smap[sid]["originalCodeFileName"];
      var lineNumber = sandbox.smap[sid][iid];
      return fileName + ":" + lineNumber;
    }


    function LogData() {
        var stringMap = {};
        var stringList = [];
        var stringCount = 0;
        var lastiid = -1;
        var lastsid = -1;

        var traceWriter;
        var isDriver;  // Function -> Boolean (true if given function is the driver)
        var traceName; // [Args] -> String    (name of a new trace; given the arguments of the driver function)

        function logEvent(str) {
            if (traceWriter) {
                traceWriter.logToFile(str+"\n");
            }
        }

        function endCurrentTrace() {
            if (traceWriter) {
                traceWriter.stopTracing();
                traceWriter = null;
            }
        }

        function newTrace(name) {
            if (traceWriter) {
                endCurrentTrace();
            }
            filename = name ? "trace-"+name+".log" : "trace.log"
            traceWriter = new sandbox.TraceWriter(filename);
        }

        if(sandbox.initParams['driver']) {
            var driver = sandbox.initParams['driver'];
            if (driver == 'nodeunit') {
                var progDir = sandbox.initParams['progDir'] || path.resolve(path.dirname(sandbox.script));
                var nodeunit = require(progDir + '/node_modules/nodeunit');
                isDriver = function(f) { return f == nodeunit.runTest } 

            }
        } else {
            newTrace();
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
            } else if (type === 'symbol') { 
                return getStringIndex(v.toString());
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
                throw new Error("getStringIndex should only be called for strings, not " + (typeof str))
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

        function getOffset(key) {
            key = key && key.toString() || (key + "");
            return getStringIndex(key);
        }


        // Handle native functions that read objects in pre, since callbacks may modify the data itself
        this.invokeFunPre = function (iid, f, base, args, isConstructor, isMethod, functionIid) {
            lastiid = iid;
            lastsid = sandbox.sid;

            // If there is no current trace and there is a defined driver then check if we are entering the driver
            if (!traceWriter && isDriver && isDriver(f)) {
                newTrace(traceName(args));
            }

            // If f is Function.prototype.call or Function.prototype.apply, then forward to the called function
            if (isMethod && f === Function.prototype.call) {
                var func = base;
                var newBase = args.length > 0 ? args[0] : undefined;
                this.invokeFunPre(iid, func, newBase, Array.prototype.slice.call(args, 1), isConstructor, !!newBase, functionIid);
            } else if (isMethod && f === Function.prototype.apply) {
                var func = base;
                var newBase = args.length > 0 ? args[0] : undefined;
                var newArgs = args.length > 1 && args[1] && args[1].length ? args[1] : [];
                this.invokeFunPre(iid, func, newBase, newArgs, isConstructor, !!newBase, functionIid);
            }

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
            // If there is a current trace and there is a defined driver then check if we are exiting the driver
            if (traceWriter && isDriver && isDriver(f)) {
                endCurrentTrace();
            }

            // If f is Function.prototype.call or Function.prototype.apply, then forward to the called function
            if (isMethod && f === Function.prototype.call) {
                var func = base;
                var newBase = args.length > 0 ? args[0] : undefined;
                this.invokeFun(iid, func, newBase, Array.prototype.slice.call(args, 1), result, isConstructor, !!newBase, functionIid);
            } else if (isMethod && f === Function.prototype.apply) {
                var func = base;
                var newBase = args.length > 0 ? args[0] : undefined;
                var newArgs = args.length > 1 && args[1] && args[1].length ? args[1] : [];
                this.invokeFun(iid, func, newBase, newArgs, result, isConstructor, !!newBase, functionIid);
            }

            if (isConstructor) {
                if (f === Array) {
                    //this.writeProp(iid, result, "length");
                    this.writeOwnProps(iid, result);
                } else if (f === Function) {
                    this.writeProp(iid, result, "name");
                    this.writeProp(iid, result, "length");   
                    this.writeProp(iid, result, "prototype");                  
                } else if (f === Object) {
                    this.writeOwnProps(iid, result);
                }
            } else if (isMethod && Array.isArray(base)) {
                var arr = base;
                var params = Array.prototype.slice.call(args, 0);
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
                    f === Array.prototype.unshift    // Similar to shift
                    ) {
                    //this.writeProp(iid, arr, "length");
                    this.writeOwnProps(iid, arr);          
                } else 
                // Special handling for push/pop since they are so common
                if (f === Array.prototype.pop) {
                    //this.readProp(iid, arr, "length")
                    this.readProp(iid, arr, "length")
                    this.writeProp(iid, arr, "length")
                } else if (f === Array.prototype.push) {
                    //this.writeProp(iid, arr, "length")
                    var idx = arr["length"] - 1, elems = params.length;
                    while (elems--) {
                        this.writeProp(iid, arr, idx--);
                    }
                }
            
            } else if (f === Array.from || f === Array.of) { 
                this.writeProp(iid, result, "length");
                this.writeOwnProps(iid, result);                
            } else if (f === Object.defineProperty && args.length >= 2) {
                var obj = args[0];
                var prop = args[1];
                // Property has a value if no descriptor or descriptor with value is provided
                if (args.length == 2 || "value" in args[2]) {
                  this.writeProp(iid, obj, prop);
                }
            } else if (f === Object.defineProperties && args.length >= 2) {
                var obj = args[0];
                var props = args[1];
                for (k in props) {
                    if (Object.prototype.hasOwnProperty(props, k)) {
                        var prop = k;
                        var desc = props[k];
                        if ("value" in desc) {
                          this.writeProp(iid, obj, prop);
                        }
                    }
                }
            } 
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
            var v = getValue(val);
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
                    // Generate a "write" event only if the property is a data-field (i.e. not getter or setter)
                    if (Object.prototype.hasOwnProperty.call(lit, key) && ('value' in Object.getOwnPropertyDescriptor(lit, key))) {
                        this.putFieldPre(iid, lit, key, lit[key], false, false);
                    }
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
            logEvent('C,'+lastsid+","+lastiid+","+sandbox.sid+","+iid+","+getValue(f)+","+frameId);
            // Then, declare the write of "this" before moving to declaring args and function declarations (see the 'declare' callback)
            logEvent('D,'+sandbox.sid+","+iid+"," + frameId + "," + getStringIndex("this") + "," + getValue(dis) + "," + getType(dis));
        };

        this.functionExit = function (iid, returnVal, wrappedExceptionVal) {
            logEvent('E,' + sandbox.sid + "," + iid + "," + getValue(returnVal) + "," + getType(returnVal));
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
        
        /**
         * in node.js endExecution() is called too early (Jalangi bug?) so we register a process exit call-back.
         */
        process.on('exit', function () {
            endCurrentTrace();
            fs.writeFileSync('strings.json', JSON.stringify(stringList)+'\n');
            fs.writeFileSync('smap.json', JSON.stringify(sandbox.smap)+'\n');
        });
    }

    sandbox.analysis = new LogData();
})(J$);


// node src/js/commands/jalangi.js --inlineIID --inlineSource --analysis src/js/sample_analyses/ChainedAnalyses.js --analysis src/js/runtime/SMemory.js --analysis src/js/sample_analyses/datatraces/TraceWriter.js --analysis src/js/sample_analyses/datatraces/LogData.js tests/octane/deltablue.js

