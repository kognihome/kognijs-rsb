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
  var path = protoUrl.replace(/\./g,'/');
  var idx = path.lastIndexOf('/') + 1;
  var proto;
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
    console.log("Connection established: ", details);
    handle.wamp = session;
    handle.wampSession = session;
    this.wasConnected = true;
    callback();
  };

  var _this = this;

  this.connection.onclose = function (reason, details) {
    if (reason == 'unreachable') {
      callback(Error('Host unreachable'));
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
RSB.prototype.createListener = function createListener(params) {
  if (! this.isConnected()) {
    throw Error('WAMP/RSB connection is not established!');
  }
  // TODO: check params

  var _this = this;
  return new Promise( function (resolve, reject) {
    var wampScope = params.scope.substring(1,params.scope.length).replace(/\//g,'.');
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
RSB.prototype.createInformer = function createInformer(params) {
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

module.exports = RSB;
