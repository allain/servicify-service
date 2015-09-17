var Promise = require('bluebird');
var debug = require('debug')('servicify-service');
var rpc = require('node-json-rpc');
var getPort = require('get-port');
var defined = require('defined');
var uniqid = require('uniqid');
var packagePath = require('package-path');

var getParamNames = require('get-parameter-names');

function ServicifyService(opts) {
  if (!(this instanceof ServicifyService)) return new ServicifyService(opts);
  this.opts = opts || {};

  var host = this.opts.host = this.opts.host || '127.0.0.1';
  var port = this.opts.port = this.opts.port || 2020;
  this.opts.heartbeat = this.opts.heartbeat || 10000;

  debug('using servicify-server at %s:%d', host, port);

  this.serverConnection = new rpc.Client({
    host: host,
    port: port,
    path: '/servicify',
    strict: true
  });
}

ServicifyService.prototype.offer = function(target, spec) {
  var self = this;

  if (typeof target === 'string') {
    if (target.match(/^[.]/)) { // relative path
      return Promise.reject(new Error('Relative paths are not supported for registration targets'));
    }

    var packageMain;
    try {
      packageMain = require.resolve(target);
    } catch(e) {
      return Promise.reject(e);
    }

    if (!packageMain) return Promise.reject(new Error('unable to find required version of ' + target));

    var pkgPath = packagePath.sync(packageMain);
    if (!pkgPath) return Promise.reject(new Error('unable to find package for ' + target));

    var pkg = require(pkgPath + '/package.json');
    spec = {name: pkg.name, version: pkg.version};

    target = require(target);
  }

  var host = defined(spec.host, '127.0.0.1');
  var port = spec.port ? Promise.resolve(spec.port) : Promise.fromNode(getPort);

  debug('exposing %s@%s at %s:%d', spec.name, spec.version, host, port);

  return port.then(function(port) {
    var targetType;
    if (typeof target === 'function') {
      var paramNames = getParamNames(target);
      var usesCallback = paramNames[paramNames.length - 1].match(/^cb|callback$/g);
      if (usesCallback) {
        targetType = 'callback';
      } else {
        targetType = 'promised';
      }
    } else {
      throw new Error('unsupported target');
    }

    var serviceSpec = {name: spec.name, version: spec.version, host: host, port: port, type: targetType};

    var server = new rpc.Server({
      port: port,
      host: host,
      path: '/servicify/',
      strict: true
    });

    server.addMethod('invoke', function (args, cb) {
      if (targetType === 'callback') {
        args.push(cb);
      }

      var result = target.apply(null, args);
      if (result && result.then && typeof result.then === 'function') {
        result.nodeify(cb);
      } else if (!usesCallback) {
        cb(new Error('target must be asynchronous'));
      }
    });

    return Promise.fromNode(function (cb) {
      server.start(cb);
    }).then(function () {
      return sendOffer(serviceSpec);
    }).then(function(offering) {
      debug('target offered as %j', offering);
      var heartbeatIntervalid = setInterval(function () {
        sendOffer(offering).then(function(result) {
          debug('heartbeat result: %j', result);
        });
      }, self.opts.heartbeat);

      return {
        host: offering.host,
        port: offering.port,
        name: offering.name,
        server: {
          host: self.opts.host,
          port: self.opts.port
        },
        version: offering.version,
        stop: function () {
          clearInterval(heartbeatIntervalid);
          debug('rescending offer');

          return callRpc(self.serverConnection, 'rescind', [offering.id]).then(function(result) {
            debug('rescind result: %j', result);
          }).then(function() {
            return Promise.fromNode(function (cb) {
              server.stop(cb);
            });
          });
        }
      };
    });
  });

  function sendOffer(offering) {
    offering.expires = Date.now() + self.opts.heartbeat * 3;
    return callRpc(self.serverConnection, 'offer', [offering]);
  }
};



function callRpc(client, method, params) {
  return Promise.fromNode(function(cb) {
    client.call({
      'jsonrpc': '2.0',
      'method': method,
      'params': params,
      'id': uniqid()
    }, cb);
  }).then(function(res) {
    return res.result;
  });
}

module.exports = ServicifyService;

