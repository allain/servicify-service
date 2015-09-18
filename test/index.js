var test = require('blue-tape');
var ServicifyServer = require('servicify-server');
var Promise = require('bluebird');
var rpc = require('node-json-rpc');
var uniqid = require('uniqid');

var ServicifyService = require('..');

test('can be created without a server to connect to yet', function (t) {
  var ps = new ServicifyService();
  t.ok(ps instanceof ServicifyService);
  t.end();
});

test('returned service has expected API', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();
    var identity = require('async-identity');

    return ps.offer(identity, {name: 'async-identity', version: '1.0.0'}).then(function (service) {
      t.ok(service.host, 'has host');
      t.ok(service.port, 'has port');
      t.equal(service.load, 0, '0 load');
      t.equal(typeof service.invoke, 'function', 'has invoke function');
      t.deepEqual(service.server, {host: '127.0.0.1', port: 2020}, 'has server location');
      return service.stop();
    }).then(function () {
      return server.stop();
    });
  });
});

test('supports registering a function that returns promises', function(t) {
  return withServer().then(function(server) {
    var ps = new ServicifyService();
    var identity = function(x) { return Promise.resolve(x); }

    return ps.offer(identity, {name: 'identity', version: '1.0.0'}).then(function (service) {
      t.equal(typeof service.invoke, 'function', 'has invoke function');
      return service.invoke([10]).then(function(result) {
        t.equal(result, 10);
        return service.stop();
      }).then(function () {
        return server.stop();
      });
    });
  })
});

test('supports registering a package by name', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();

    return ps.offer('async-identity').then(function (service) {
      t.ok(service.host, 'has host');
      t.ok(service.port, 'has port');
      return service.stop();
    }).then(function () {
      return server.stop();
    });
  });
});

test('supports registering a package by its absolute directory', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();

    return ps.offer(__dirname + '/../node_modules/async-identity').then(function (service) {
      t.ok(service.host);
      t.ok(service.port);
      return service.stop();
    }).then(function () {
      return server.stop();
    });
  });
});

test('rejects registering a package by its relative directory', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();

    return ps.offer('../node_modules/async-identity').catch(function (err) {
      t.ok(err);
      return server.stop();
    });
  });
});

test('exposes async-callback function through rpc', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();
    var identity = require('async-identity');

    return ps.offer(identity, {name: 'async-identity', version: '1.0.0'}).then(function (service) {
      var client = new rpc.Client({
        host: service.host,
        port: service.port,
        path: '/porty',
        strict: true
      });

      return callRpc(client, 'invoke', [10]).then(function (result) {
        t.equal(result, 10);
        return service.stop();
      }).then(function () {
        return server.stop();
      });
    });
  });
});

test('exposes async-promise function through rpc', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();
    var identity = function(x) { return Promise.resolve(x); }

    return ps.offer(identity, {name: 'identity', version: '1.0.0'}).then(function (service) {
      var client = new rpc.Client({
        host: service.host,
        port: service.port,
        path: '/porty',
        strict: true
      });

      return callRpc(client, 'invoke', [10]).then(function (result) {
        t.equal(result, 10);
        return service.stop();
      }).then(function () {
        return server.stop();
      });
    });
  });
});

test('invocations affects load between heartbeats', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService({heartbeat: 10});
    var identity = require('async-identity');

    return ps.offer(identity, {name: 'async-identity', version: '1.0.0'}).then(function (service) {
      var client = new rpc.Client({
        host: service.host,
        port: service.port,
        path: '/porty',
        strict: true
      });
      var startLoad = service.load;

      return Promise.all([
        callRpc(client, 'invoke', [1]),
        callRpc(client, 'invoke', [2]),
        callRpc(client, 'invoke', [3])
      ]).then(function () {
        return Promise.delay(5);
      }).then(function () {
        t.ok(startLoad < service.load, startLoad + ' load < ' + service.load + ' load');
        return Promise.delay(10);
      }).then(function () {
        t.equal(service.load, 0);
        return service.stop();
      }).then(function () {
        return server.stop();
      });
    });
  });
});

function withServer() {
  var server = new ServicifyServer();
  return server.listen();
}

function callRpc(client, method, params) {
  return Promise.fromNode(function (cb) {
    client.call({
      'jsonrpc': '2.0',
      'method': method,
      'params': params,
      'id': uniqid()
    }, cb);
  }).then(function (res) {
    return res.result;
  });
}