var
  util = require('util'),
  os = require('os'),
  request = require('request'),
  version = require('./package.json').version;

console.log('Starting Joola Agent, version ' + version + '.');

var cnc = 'https://cnc.joo.la'; //https://localhost:9091';

var loads = os.loadavg();
var hostname = os.hostname();

var usage_os = {
  uid: hostname.replace('.c.integrated-net-594.internal', ''),
  uptime: os.uptime(),
  mem_total: os.totalmem(),
  mem_free: os.freemem(),
  load_1_min: loads[0],
  load_5_min: loads[1],
  load_15_min: loads[2]
};

//console.log(usage_os);

var postOptions = {
  url: cnc + '/api/nodes/usage?APIToken=apitoken-itay',
  headers: {
    'Content-Type': 'application/json'
  },
  method: "POST",
  json: usage_os,
  rejectUnauthorized: false,
  requestCert: true,
  agent: false
};

request(postOptions, function (error, response, body) {
  if (error)
    throw error;

  hostname = hostname.replace('.c.integrated-net-594.internal', '').substring(2);
  hostname = hostname.substring(0, hostname.length - 2);
  var usage_joola = {
    uid: hostname,
    version: 0,
    sdk_version: 0,
    writes: 0,
    reads: 0,
    simple: 0,
    last_used: 0
  };

  var user = {
    username: 'impersonate_' + 'agent' + '_stats',
    password: 'impersonate_' + 'agent' + '_stats',
    workspace: '_stats',
    roles: ['reader'],
    filter: [
    ]
  };

  var postOptions = {
    url: 'https://localhost:8081/tokens?APIToken=apitoken-demo',
    headers: {
      'Content-Type': 'application/json'
    },
    method: "POST",
    json: user,
    rejectUnauthorized: false,
    requestCert: true,
    agent: false
  };

  request(postOptions, function (err, response, body) {
    if (err)
      throw (err || new Error(body));

    var token = body._;
    var query = {
      timeframe: 'last_30_days',
      interval: 'day',
      dimensions: [],
      metrics: [
        {key: 'writeCount', collection: 'writes', name: 'Writes'},
        {key: 'readCount', collection: 'reads', name: 'Reads'}
      ]
    };

    var postOptions = {
      url: 'https://localhost:8081/query?token=' + token,
      headers: {
        'Content-Type': 'application/json'
      },
      method: "POST",
      json: query,
      rejectUnauthorized: false,
      requestCert: true,
      agent: false
    };
    request(postOptions, function (err, response, results) {
      if (!err && response.code === 200 && results && results.documents && results.documents.length > 0)
        throw (err || new Error(results));

      if (results && results.documents && results.documents.length > 0) {
        usage_joola.reads = results.documents[0].values.readCount;
        usage_joola.writes = results.documents[0].values.writeCount;
      }

      var postOptions = {
        url: 'https://localhost:8081/usage/last_use?APIToken=apitoken-demo',
        headers: {
          'Content-Type': 'application/json'
        },
        method: "GET",
        rejectUnauthorized: false,
        requestCert: true,
        agent: false
      };
      request(postOptions, function (err, response, results) {
        if (err)
          throw (err || new Error(results));

        results = JSON.parse(results);
        usage_joola.last_used = new Date(results.last_use);

        var postOptions = {
          url: 'https://localhost:8081/system/version?APIToken=apitoken-demo',
          headers: {
            'Content-Type': 'application/json'
          },
          method: "GET",
          rejectUnauthorized: false,
          requestCert: true,
          agent: false
        };
        request(postOptions, function (err, response, results) {
          if (err)
            throw (err || new Error(results));

          results = JSON.parse(results);
          usage_joola.version = results.version;
          usage_joola.sdk_version = results.sdk_version;
          console.log(usage_joola);

          var postOptions = {
            url: cnc + '/api/applications/usage?APIToken=apitoken-itay',
            headers: {
              'Content-Type': 'application/json'
            },
            method: "POST",
            json: usage_joola,
            rejectUnauthorized: false,
            requestCert: true,
            agent: false
          };

          request(postOptions, function (error, response, body) {
            if (error)
              throw error;

            console.log('Joola Agent done.');
          });
        });
      });
    });
  });
});