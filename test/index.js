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

test('supports registering a function as a service', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();
    var identity = require('async-identity');

    return ps.register(identity, {name: 'async-identity', version: '1.0.0'}).then(function (service) {
      t.ok(service.host);
      t.ok(service.port);
      t.deepEqual(service.server, {host: '127.0.0.1', port: 2020});
      return service.stop();
    }).then(function () {
      return server.stop();
    });
  });
});

test('supports registering a package', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();

    return ps.register('async-identity').then(function (service) {
      t.ok(service.host);
      t.ok(service.port);
      return service.stop();
    }).then(function () {
      return server.stop();
    });
  });
});

test('exposes function through rpc', function (t) {
  return withServer().then(function (server) {
    var ps = new ServicifyService();
    var identity = require('async-identity');

    return ps.register(identity, {name: 'async-identity', version: '1.0.0'}).then(function (service) {
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