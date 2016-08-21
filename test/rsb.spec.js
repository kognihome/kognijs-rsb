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
  this.rpcStub.resolves('rpc stub');

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

  it('should return default values', function() {
    var idx = 0;
    // return two times null to go through the branches
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
              done();
            }
          })
        }, function(err) {done(err)});
    })

  });
});

