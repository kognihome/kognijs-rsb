# KogniJS - RSB [![Build Status](https://travis-ci.org/aleneum/kognijs-rsb.svg?branch=master)](https://travis-ci.org/aleneum/kognijs-rsb) [![Coverage Status](https://coveralls.io/repos/github/aleneum/kognijs-rsb/badge.svg?branch=master)](https://coveralls.io/github/aleneum/kognijs-rsb?branch=master)

Wraps the Web Application Messaging Protocol ([WAMP](http://wamp-proto.org/)) and Protocol Buffers into a
web version of the Robotic Service Bus ([RSB](https://code.cor-lab.org/projects/rsb)). WAMP is kindly provided by
[autobahn](http://autobahn.ws/) and Protocol Buffers are provided by [protobuf.js](https://github.com/dcodeIO/ProtoBuf.js/).

This module is part of the [KogniJS]((https://travis-ci.org/aleneum/kognijs) framework.
It is developed within the [KogniHome](https://kogni-home.de/) project to help developers to 
create tailored and flexible interfaces for smart home environments.

### Requirements

To work with WAMP, a server is needed such as [crossbar](http://crossbar.io/) which does understand the protocol.
If you want to connect to an RSB network you will need the [kogniserver](https://github.com/aleneum/kogniserver) which builds upon crossbar.

## Getting Started

### NPM

```shell
npm install kognijs-rsb
```

In your javascript file require the module and create an instance to be used:

```javascript
var RSB = require('kognijs-rsb');
var rsb = new RSB();
```

### Bower or CDN

*REMARK: This version is minified and packages all dependencies (autobahn and protobuf.js) as well as their dependencies.*
Install the module via Bower and add dependencies with [wiredep](https://github.com/taptapship/wiredep) for instance:

```shell
bower install kognijs-rsb
```

You can include kognijs-rsb directly in your HTML file:

```html
<script src="https://cdn.rawgit.com/aleneum/kognijs-rsb/v0.2.1/redist/kognijs.rsb.min.js"></script>
```

The `RSB` object resides in the *KogniJS* namespace:

```javascript
var RSB = KogniJS.RSB;
var rsb = new RSB();
```

## Usage

Make sure that your ```crossbar``` and ```kogniserver``` are running.

### Connect to the server

Connect to the server. `url` could be `localhost:8181` for instance. The callback method is called when the connection is established and Listeners and Informers can be created.

```javascript
rsb.connect(url, function() {
  // is called when the connection was established
  // do your rsb stuff here
  // create as much listeners and informers as you like
});
```

### Listen to Messages

Scopes can be set as strings like in any other implementation of RSB.
Possible types are native types such as RSB.STRING, RSB.INTEGER, RSB.FLOAT (or RSB.DOUBLE)
or RST types like "rst.generic.Value". The callback value is either a js native type or an
object representing the Protocol Buffer derived from RST.

```javascript

// listen to primitive type
rsb.createListener({
  scope: "/rsb/web/tour/string",
  type: RSB.STRING,
  callback: function(value) {
    console.log(value)
  }
});

// listen to RST type
rsb.createListener({
  scope: "/rsb/web/tour/value",
  type: "rst.generic.Value",
  callback: function(value) {
    console.log(value)
  }
});
```

### Publish Messages
While listening is handled by the global rsb instance, publishers have to be handled manually.
This design decision allows a more flexible and also familiar way of sending messages.

```javascript
var pub = rsb.createInformer({
  scope: "/rsb/web/tour/keyvaluepair",
  type: "rst.generic.KeyValuePair",
  callback: function() {
    pub.publish({
      key:"foo",
      value: {type: 4, string: 'bar'}
    })
  }
});
```

This looks a bit confusing because we have a return value AND (optionally) a callback.
The method ```createInfomer``` returns a ```RSBInformer``` synchronously but the scope registration
happens asynchronously. If you plan to use your informer right away you can stick to the code above
and use the callback which is called _once_ the scope is registered.
If you just want to create an informer callback can also be an empty method.


## Interactive Demo

An interactive demo can be started with npm and gulp:

```bash
git clone https://github.com/aleneum/kognijs-rsb.git kognijs-rsb
cd kognijs-rsb
npm install -g gulp # if you havent done already
npm install
gulp serve
```

A browser window should open to `localhost:3000` with an interactive tour.
This demo requires a running [kogniserver](https://github.com/aleneum/kogniserver) instance.

