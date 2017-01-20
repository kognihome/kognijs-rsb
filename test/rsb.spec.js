"use strict";
var chai = require("chai");
var expect = require('chai').expect;
var sinon = require("sinon");
var sinonChai = require("sinon-chai");
var sinonAsPromised = require('sinon-as-promised');
var RSB = require('../src/rsb');
var ProtoBuf = require('protobufjs');
var autobahn = require('autobahn');
var fs = require('fs');

chai.should();
chai.use(sinonChai);

var wampMock;
var openStub;
var ValueProto = fs.readFileSync('./examples/proto/rst/generic/Value.proto', 'utf8');

function WampMock() {
  this.isOpen = true;
  this.publishedMessages = {};
  this.subscribedScopes = {};

  this.subscriptionResult = sinon.stub();
  this.subscriptionResult.resolves('subscription stub');

  this.rpcStub = sinon.stub();
  this.rpcStub;

}

WampMock.prototype.getScopes = function() {
  return Object.keys(this.subscribedScopes);
};

WampMock.prototype.subscribe = function(scope, callback) {
  if (!(scope in this.subscribedScopes)) {this.subscribedScopes[scope] = []}
  this.subscribedScopes[scope].push(callback);
  return this.subscriptionResult();
};

WampMock.prototype.publish = function(scope, arr) {
  if (!(scope in this.publishedMessages)) {this.publishedMessages[scope] = []}
  this.publishedMessages[scope].push(arr);
  if (scope in this.subscribedScopes) {
    for (var i = 0; i < this.subscribedScopes[scope].length; ++i) {
      this.subscribedScopes[scope][i](arr);
    }
  }
};

WampMock.prototype.call = function(scope, args) {
  if (scope.endsWith('call')) {
    this.rpcStub.resolves(args[2]);
  } else if (scope.endsWith('register')) {
    this.rpcStub.resolves('registered')
  } else {
    thos.rpcStub.rejects('method not known');
  }
  return this.rpcStub();
};


describe('RSB', function() {
  beforeEach(function () {
    global.document = {location: {protocol: "http:", host:'localhost'}};
    this.sinon = sinon.sandbox.create();
    wampMock = new WampMock();
    openStub = this.sinon.stub(autobahn.Connection.prototype, 'open', function(){
      this.onopen(wampMock, 'connection stub');
    });
  });

  afterEach(function () {
    this.sinon.restore();
  });

  it('should initialize a stubbed connection', function(done) {
    var rsb = new RSB();
    rsb.connect(undefined, function(err){
      expect(err).to.be.an('undefined');
      expect(rsb.wsuri).to.be.equal('ws://localhost/ws');
      rsb = new RSB();
      rsb.connect('localhost:8181', function() {
        expect(rsb.wsuri).to.be.equal('ws://localhost:8181/ws');
        document.location.protocol = 'file:';
        rsb = new RSB();
        rsb.connect(undefined, function() {
          expect(rsb.wsuri).to.be.equal('ws://127.0.0.1:8080/ws');
          done();
        });
      });
    });
  });

  it('it should silently accept unreachable', function(done) {
    openStub.restore();
    this.sinon.stub(autobahn.Connection.prototype, 'open', function(){
      this.onclose('unreachable', 'this is just a test');
    });
    var rsb = new RSB();
    rsb.connect(undefined, function(err){
      expect(err).to.be.an('Error');
      expect(rsb.isConnected()).to.be.false;
      done()
    });
  });

  it('should return true for isConnected()', function(done) {
    var rsb = new RSB();
    rsb.connect(undefined, function(){
      if (rsb.isConnected()) {
        done();
      }
    });
  });

  it('should createPingPong()', function(done) {
    var rsb = new RSB();
    wampMock.subscriptionResult.onCall(0).rejects('subscription stub first call fails');
    wampMock.rpcStub.onCall(0).rejects('rpc stub first call fails');

    expect(function(){rsb.createPingPong()}).to.throw(Error);
    expect(wampMock.getScopes()).to.have.length(0);
    rsb.connect(undefined, function(){
      rsb.createPingPong().then(
        function(res) {done(Error('subscription should be refused at first attempt!'))},
        function(err) {
          return rsb.createPingPong();
        }
      ).then(
        function(res) {
          expect(wampMock.getScopes()).to.have.length(1);
          expect("com.wamp.ping" in wampMock.subscribedScopes).to.be.true;
          wampMock.publish("com.wamp.ping", ["ping"]);
          done();
        },
        function(err) {done(err)}
      );
    });
  });

  it('should createListener()', function(done) {
    var rsb = new RSB();
    wampMock.subscriptionResult.onCall(0).rejects('subscription stub first call fails');
    wampMock.rpcStub.onCall(0).rejects('rpc stub first call fails');
    var params = {scope:'/foo/bar', type:RSB.STRING, callback: function(val){}};
    expect(function() {rsb.createListener(params)}).to.throw(Error);
    expect(wampMock.getScopes()).to.have.length(0);
    rsb.connect(undefined, function() {
      rsb.createListener(params)
        .then(
          function(res) {
            done(Error('createListener should reject since wampSession rejects'))},
          function(err) {
            return rsb.createListener(params);
          })
        .then(
          function(res) {
            expect(wampMock.getScopes()).to.have.length(1);
            expect("foo.bar" in wampMock.subscribedScopes).to.be.true;
            done();
          },
          function(err) {
            done(err);
        });
    });
  });

  it('should createInformer()', function(done) {
    var rsb = new RSB();
    wampMock.subscriptionResult.onCall(0).rejects('subscription stub first call fails');
    wampMock.rpcStub.onCall(0).rejects('rpc stub first call fails');
    var params = {scope:'/foo/bar', type:RSB.STRING, callback: function(val){}};
    var inf;

    expect(function() {rsb.createInformer(params)}).to.throw(Error);
    expect(wampMock.getScopes()).to.have.length(0);

    params.callback = function shouldFail(err, res) {
      if (! err) {return done(Error('createInformer should return error since first call to subscribe should fail'))}
      params.callback = function shouldPass(err, res) {
        if (err) {return done(err)}
        expect(wampMock.getScopes()).to.have.length(0);
        done();
      };
      inf = rsb.createInformer(params);
    };

    rsb.connect(undefined, function() {
      inf = rsb.createInformer(params)
    });
  });

  it('should createRemoteServer()', function(done) {
    var rsb = new RSB();
    var params = {name: 'echo', input: RSB.STRING, output: RSB.STRING};
    expect(function() {rsb.createRemoteServer('/foo/bar')}).to.throw(Error);

    rsb.connect(undefined, function () {
      var server = rsb.createRemoteServer('/foo/bar');
      server.addMethod(params);
      var i = 'hello';
      var p = server.echo(i);
      expect(p).to.be.a('Promise');
      p.then(
        function(o){
          expect(o).to.be.equal(i);
          done();
        },
        function(err){done(err);}
      );
    });
  });

  it('should return default values', function() {
    var idx = 0;
    // return null two times to simulate missing file at /proto and /proto/sandbox
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      if (idx < 2) {
        idx += 1;
        return null;
      }
      return ProtoBuf.loadProto(ValueProto);
    });

    expect(RSB.getDefault('string')).to.be.equal('');
    expect(RSB.getDefault('float')).to.be.equal(0.0);
    expect(RSB.getDefault('integer')).to.be.equal(0);
    expect(RSB.getDefault('bool')).to.be.equal(false);
    expect(RSB.getDefault('rst.generic.Value')).to.have.property('type', null);
    expect(RSB.getDefault('rst.generic.Value')).to.have.property('string', null);
    // for coverage, also use the /proto case
    idx = 1;
    expect(RSB.getDefault('rst.generic.Value')).to.have.property('bool', null);
    idx = -1;
    expect(function(){RSB.getDefault('rst.generic.Value')}).to.throw(Error);
  });

  it('should receive a simple message', function (done) {
    var rsb = new RSB();
    rsb.connect(undefined, function(){
      var inf = rsb.createInformer({
        scope: '/foo/bar',
        type: RSB.STRING,
        callback: function(err, res) {
          if (err) {return done(err)}
          rsb.createListener({
            scope: '/foo/bar',
            type: RSB.STRING,
            callback: function(val) {
              expect(val).to.be.equal('hello');
              done();
            }
          }).then(
            function(res) {
              expect(wampMock.getScopes()).to.have.length(1);
              inf.publish('hello')
            },
            function(err) {done(err)}
          )
        }
      })
    });
  });

  it('should receive a Value proto message', function (done) {
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      return ProtoBuf.loadProto(ValueProto);
    });
    var rsb = new RSB();
    rsb.connect(undefined, function(){
      var inf = rsb.createInformer({
        scope: '/foo/bar',
        type: 'rst.generic.Value',
        callback: function(err, res) {
          if (err) {return done(err)}
          rsb.createListener({
            scope: '/foo/bar',
            type: 'rst.generic.Value',
            callback: function(val) {
              expect(val.string).to.be.equal('hello');
              done();
            }
          }).then(
            function(res) {
              expect(wampMock.getScopes()).to.have.length(1);
              inf.publish({type:4, string: "hello"})
            },
            function(err) {done(err)}
          )
        }
      })
    });
  });

  it('should return a Value proto message', function (done) {
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      return ProtoBuf.loadProto(ValueProto);
    });
    var rsb = new RSB();
    rsb.connect(undefined, function(){
      var server = rsb.createRemoteServer('/foo/bar')
      server.addMethod({name:'echo', input:'rst.generic.Value', output: 'rst.generic.Value'})
      server.echo({type: 4, string: 'hello'}).then(
        function(res) {
          expect(res.string).to.be.equal('hello');
          done();
        },
        function(err) { done(err); }
      )
    });
  });

  it('should fail due to failed deserialization ', function (done) {
    wampMock.rpcStub.onCall(0).resolves('not deserializable');
    wampMock.rpcStub.onCall(1).rejects('cannot call');
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      return ProtoBuf.loadProto(ValueProto);
    });
    var rsb = new RSB();
    var value = {type: 4, string: 'hello'};
    rsb.connect(undefined, function(){
      var server = rsb.createRemoteServer('/foo/bar');
      server.addMethod({name:'echo', input:'rst.generic.Value', output: 'rst.generic.Value'})
      server.echo(value).then(
        function(res) {
          done(Error('Message should not be deserializable'));
        },
        function(err) {
          server.echo(value).then(
            function (res) {done(Error('call should be rejected'))},
            function (err) {done()})
        }
      )
    });
  });


  it('should block publishing', function(done) {
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      return ProtoBuf.loadProto(ValueProto);
    });
    var rsb = new RSB();
    rsb.connect(undefined, function() {
      rsb.createInformer({
        scope: "/foo/bar",
        type: RSB.STRING,
        callback: function(err, res, inf) {
          inf.block = true;
          inf.publish('foo');
          expect('foo.bar' in wampMock.publishedMessages).to.be.false;
          expect(inf.block).to.be.false;
          rsb.createInformer({
            scope: "/foo/bar",
            type: 'rst.generic.Value',
            callback: function(err, res, inf) {
              inf.block = true;
              inf.publish({type:4, string: 'hello'});
              expect('foo.bar' in wampMock.publishedMessages).to.be.false;
              expect(inf.block).to.be.false;
              done();
            }
          });
        }
      })
    });
  })

  it('should not call listener callback due to wrong data', function(done){
    var protoStub = this.sinon.stub(ProtoBuf, 'loadProtoFile', function(fp){
      return ProtoBuf.loadProto(ValueProto);
    });
    var rsb = new RSB();
    rsb.connect(undefined, function() {
      rsb.createListener({
        scope: '/foo/bar',
        type: 'rst.generic.Value',
        callback: function(val) {
          done(Error('received false callback!'));
        }
      })
        .then(function(res) {
          rsb.createInformer({
            scope: '/foo/bar',
            type: RSB.STRING,
            callback: function(err, res, inf) {
              inf.publish('hello');
              setTimeout(function(){done()}, 20)
            }
          })
        }, function(err) {done(err)});
    })

  });

  it('should timeout if server does not answer', function(done) {
    this.sinon.restore();
    this.sinon.stub(autobahn.Connection.prototype, 'open', function(){
      // do nothing when connection is opened
    });
    var closeStup = sinon.stub();
    this.sinon.stub(autobahn.Connection.prototype, 'close', function(){
      closeStup();
    });

    this.timeout(5000);
    var rsb = new RSB();
    rsb.connect('129.1.1.1:8181', function(err) {
      expect(err).to.be.an('Error');
      expect(closeStup.called).to.be.true;
      done();
    });
  });

  // it('it should timeout connection', function(done) {
  //   openStub.restore();
  //   var closeStup = sinon.stub();
  //
  //
  //   this.sinon.stub(autobahn.Connection.prototype, 'close', function(){
  //     closeStup();
  //   });
  //   var rsb = new RSB();
  //   rsb.connect(undefined, function(err){
  //     expect(err).to.be.an('Error');
  //     expect(rsb.isConnected()).to.be.false;
  //     done()
  //   });
  // });

});
