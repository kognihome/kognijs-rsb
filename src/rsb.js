/*
 * kognijs-rsb
 * https://github.com/aleneum/kognijs-rsb
 *
 * Copyright (c) 2016 Alexander Neumann
 * Licensed under the MIT license.
 */

var autobahn = require("autobahn");
var ProtoBuf = require("protobufjs");

// rstFolders (optional)
function RSB(params) {
  var params = params || {};
  //var rstFolders = params.rstFolders || [];
  //rstFolders = (Array.isArray(rstFolders) ? rstFolders : [rstFolders]);
  this.wasConnected = false;
  this.wsuri = undefined;
  this.connection = undefined;
  this.wamp = undefined;
  this.errorCount = 0;
  this.wampSession = undefined;
  this.rstPath = ' ';
  this.informers = undefined;
}

RSB.STRING = "string";
RSB.FLOAT = "float";
RSB.DOUBLE = "float";
RSB.INTEGER = "integer";
RSB.BOOL = "bool";
RSB.SIMPLE_TYPES = [RSB.STRING, RSB.FLOAT, RSB.INTEGER, RSB.BOOL];


RSB.createProto = function(protoUrl) {
  var proto = undefined;
  // try {
  //   proto = require('./proto/'+protoUrl)
  // } catch(e) {
  //   console.log('Proto Builder not packaged. Load .proto file instead.')
  // }
  if (!proto) {
    var path = protoUrl.replace(/\./g,'/');
    var fp = {root:"/proto", file: path + ".proto"};

    proto = ProtoBuf.loadProtoFile(fp);
    // RST proto files are provided in $prefix/share/rst$VERSION/proto
    // in two separate folders named 'sandbox' and 'stable'.
    if (! proto) {
      var sandbox_fp = {root: fp.root + '/sandbox', file: fp.file};
      proto = ProtoBuf.loadProtoFile(sandbox_fp);
      if (! proto) {
        var stable_fp = {root: fp.root + '/stable', file: fp.file};
        proto = ProtoBuf.loadProtoFile(stable_fp);
      }
    }
  }
  if (!proto) {
    throw Error("Proto file " + protoUrl + " not found");
  }
  proto = proto.build(protoUrl);
  return proto;
};

RSB.getDefault = function(type) {
  if (type == RSB.STRING) {
    return "";
  } else if (type == RSB.FLOAT) {
    return 0.0;
  } else if (type == RSB.INTEGER) {
    return 0;
  } else if (type == RSB.BOOL) {
    return false;
  } else {
    var Proto = RSB.createProto(type);
    return new Proto();
  }
};

RSB.prototype.connect = function(url, callback) {
  var callback_processed = false;
  if (url) {
    this.wsuri = "ws://" + url + "/ws";
  } else if (document.location.protocol == "file:") {
    this.wsuri = "ws://127.0.0.1:8080/ws";
  } else {
    this.wsuri = (document.location.protocol === "http:" ? "ws:" : "wss:") + "//" +
      document.location.host + "/ws";
  }

  this.connection = new autobahn.Connection({
    url: this.wsuri,
    realm: "realm1",
    retry_if_unreachable: false,
  });

  var handle = this;
  this.connection.onopen = function (session, details) {
    clearTimeout(timer);
    console.log("Connection established: ", details);
    handle.wamp = session;
    handle.wampSession = session;
    console.log("Reset previous subscriptions...");
    var subs = session.subscriptions || [];
    for (var i = 0; i < subs.length; ++i) {
      this.wamp.unsubscribe(subs[i]);
    }
    this.wasConnected = true;
    if (! callback_processed) {
      callback_processed = true;
      callback();
    }
  };

  var _this = this;

  var timer = setTimeout(function () {
    _this.connection.close();
    _this.connection.onclose('unreachable', 'timeout');
  }, 4000);

  this.connection.onclose = function (reason, details) {
    clearTimeout(timer);
    if (reason == 'unreachable') {
      if (! callback_processed) {
        callback_processed = true;
        callback(Error('Host unreachable'));
      }
    } else {
      console.log('Connection lost', reason);
    }
  };

  this.connection.open();
};

RSB.prototype.createPingPong = function() {
  if (! this.isConnected()) {
    throw Error('WAMP/RSB connection is not established!');
  }
  var w = this.wamp;
  return w.subscribe("com.wamp.ping", function(args) {
    // only answer to ping
    if (args.indexOf("ping") > -1) {
      w.publish("com.wamp.ping", ["pong"]);
    }
  });
};

// params scope; type; callback
RSB.prototype.createListener = function(params) {
  if (! this.isConnected()) {
    throw Error('WAMP/RSB connection is not established!');
  }
  // TODO: check params

  var _this = this;
  return new Promise( function (resolve, reject) {
    var wampScope = params.scope.substring(1 ,params.scope.length).replace(/\//g,'.');
    var cb;
    if ((RSB.SIMPLE_TYPES.indexOf(params.type) == -1)) {
      var p = RSB.createProto(params.type);
      cb =  function(args) {
        try {
          var payload = args[0];
          var dataOut = p.decode64(payload.substring(1));
          params.callback(dataOut);
        } catch(err) {
          console.log("Error on scope", wampScope, err)
        }
      }
    } else {
      cb = function(args) {
        params.callback(args[0]);
      };
    }

    Promise.all([
      _this.wamp.subscribe(wampScope, cb),
      _this.wamp.call('service.displayserver.register', [params.scope, params.type])]
    ).then(function(res){resolve(res)}, function(err){reject(err)});
  });
};

// params rsb; scope; type; callback
function RSBInformer(params) {
  this.rsb = params.rsb;
  this.type = params.type;
  this.block = false;
  this.wampScope = params.scope.substring(1,params.scope.length).replace(/\//g,'.');
  if (RSB.SIMPLE_TYPES.indexOf(params.type) == -1) {
    this.Proto = RSB.createProto(this.type);
    this.publish = function(msg) {
      if (this.block) {
        this.block = false;
        return;
      }
      var m = (Object.getPrototypeOf(msg).hasOwnProperty('$type')) ? msg : new this.Proto(msg);
      this.rsb.wamp.publish(this.wampScope, ['\0' + m.encode64()]);
    };
  } else {
    this.publish = function(msg) {
      if (this.block) {
        this.block = false;
        return;
      }
      this.rsb.wamp.publish(this.wampScope, [msg]);
    };
  }

  var _this = this;
  this.rsb.wamp.call('service.displayserver.register',
    [params.scope, params.type]).then(
    function (res) {
      if (params.callback) {
        params.callback(undefined, res, _this);
      }
    },
    function (err) {
      if (params.callback) {
        params.callback(err, undefined, _this);
      }
    }
  );
}

// scope; type; callback
RSB.prototype.createInformer = function(params) {
  if (! this.isConnected()) {
    throw Error('WAMP/RSB connection is not established!');
  }
  return new RSBInformer({
    rsb:this, scope:params.scope,
    type:params.type,
    callback:params.callback,
  });
};

RSB.prototype.isConnected = function() {
  if (this.wampSession) {
    return this.wampSession.isOpen;
  }
  return false;
};

// params array of (name, input, output)
function RSBRemoteServer(wamp, scope) {
  this.wamp = wamp;
  this.scope = scope;
}

//params name, input, output
RSBRemoteServer.prototype.addMethod = function(params){
  var serialize;
  if (RSB.SIMPLE_TYPES.indexOf(params.input) == -1) {
    this.Proto = RSB.createProto(this.input);
    serialize = function(msg) {
      var m = (Object.getPrototypeOf(msg).hasOwnProperty('$type')) ? msg : new this.Proto(msg);
      return ['\0' + m.encode64()];
    };
  } else {
    serialize = function(msg) {
      return [msg];
    };
  }

  var deserialize;
  if ((RSB.SIMPLE_TYPES.indexOf(params.output) == -1)) {
    var p = RSB.createProto(params.output);
    deserialize = function(args) {
      try {
        return p.decode64(args[0].substring(1));
      } catch(err) {
        console.log("Error on scope", wampScope, err)
      }
    }
  } else {
    deserialize = function(args) {
      return args[0];
    };
  }

  this[params.name] = function(arg) {
    return new Promise(function (resolve, reject){
      wamp.call('service.displayserver.call', scope, params.name, serialize(arg),
                params.input, params.output)
        .then(function(res) { resolve(deserialize(res)) })
        .catch(function(err){ reject(err) })
    });
  }
};

RSB.prototype.createRemoteServer = function(scope) {
  if (! this.isConnected()) {
    throw Error('WAMP/RSB connection is not established!');
  }
  return new RSBRemoteServer(this.wamp, scope)
};

module.exports = RSB;

// Helper function

// http://benalman.com/news/2012/09/partial-application-in-javascript/
function partial(fn /*, args...*/) {
  var slice = Array.prototype.slice;
  var args = slice.call(arguments, 1);
  return function() {
    return fn.apply(this, args.concat(slice.call(arguments, 0)));
  };
};

var rpc = function(wamp) {
  if (arguments.length > 4) {
    throw Error("RSB RPC calls currently support only one payload argument.")
  }
  return wamp.call('service.displayserver.call', Array.prototype.slice.call(arguments, 1));
};
