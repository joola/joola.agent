var
  config = require('./config.json'),
  util = require('util'),
  path = require('path'),
  fs = require('fs'),
  os = require('os'),
  request = require('request'),
  version = require('/opt/joola.agent/package.json').version;

var last_timestamp = null;
try {
  last_timestamp = require('/opt/joola.agent/last_timestamp.json').timestamp;
  last_timestamp = new Date(last_timestamp);
  console.log('Found last used timestamp, ' + last_timestamp.toISOString());
}
catch (ex) {
  last_timestamp = new Date();
  last_timestamp.setMonth(last_timestamp.getMonth() - 12);
}
console.log('Starting Joola Agent, version ' + version + '.');

collectLocalUsage(function (err, usage) {
  if (err)
    throw err;

  console.log('Local usage');
  console.log(util.inspect(usage, {depth: null, colors: true}));

  postLocalUsage(usage, function (err) {
    if (err)
      throw err;

    collectJoolaUsage(function (err, usage) {
      if (err)
        throw err;

      console.log('Joola usage');
      console.log(util.inspect(usage, {depth: null, colors: true}));

      return postJoolaUsage(usage, function () {
        console.log('Joola Agent done.');
      });
    });
  });
});

function fetchAPIToken(application_uid, callback) {
  var postOptions = {
    url: config.cnc.engine + '/api/applications/' + application_uid + '?APIToken=' + config.cnc.apitoken,
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

    var app = JSON.parse(results);
    var user_id = app.user_id;

    var postOptions = {
      url: config.cnc.engine + '/api/users/find?APIToken=' + config.cnc.apitoken,
      headers: {
        'Content-Type': 'application/json'
      },
      method: "POST",
      json: {
        id: user_id
      },
      rejectUnauthorized: false,
      requestCert: true,
      agent: false
    };
    request(postOptions, function (err, response, results) {
      if (err)
        throw (err || new Error(results));

      return callback(null, results[0].apitoken)
    });
  });
}

function fetchIP(callback) {
  var postOptions = {
    url: 'http://metadata/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip',
    headers: {
      'X-Google-Metadata-Request': 'True'
    },
    method: "GET",
    rejectUnauthorized: false,
    requestCert: true,
    agent: false
  };

  request(postOptions, function (error, response, body) {
    return callback(null, body);
  });
}

function collectLocalUsage(callback) {
  var loads = os.loadavg();
  var hostname = config.hostname || os.hostname();

  fetchIP(function (err, ip) {
    if (err)
      throw err;

    return callback(null, {
      uid: hostname.replace('.c.integrated-net-594.internal', ''),
      ip: ip || null,
      uptime: os.uptime(),
      mem_total: os.totalmem(),
      mem_free: os.freemem(),
      load_1_min: loads[0],
      load_5_min: loads[1],
      load_15_min: loads[2]
    });
  });
}

function postLocalUsage(usage_os, callback) {
  var postOptions = {
    url: config.cnc.engine + '/api/nodes/usage?APIToken=' + config.cnc.apitoken,
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

    return callback(null);
  });
}

function fetchJoolaStatsToken(callback) {
  var user = {
    username: 'impersonate_' + 'agent' + '_stats',
    password: 'impersonate_' + 'agent' + '_stats',
    workspace: '_stats',
    roles: ['reader'],
    filter: []
  };

  var postOptions = {
    url: config.joola.engine + '/tokens?APIToken=' + config.joola.apitoken,
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
    return callback(null, token);
  });
}

function queryJoola(token, callback) {
  var usage = {};
  var enddate = new Date();
  var query = {
    timeframe: {
      start: last_timestamp,
      end: enddate
    },
    interval: 'day',
    dimensions: [],
    metrics: [
      {key: 'writeCount', collection: 'writes', name: 'Writes'},
      {key: 'readCount', collection: 'reads', name: 'Reads'}
    ]
  };

  var postOptions = {
    url: config.joola.engine + '/query?token=' + token,
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
      usage.reads = results.documents[0].values.readCount;
      usage.writes = results.documents[0].values.writeCount;
    }

    saveTimestamp(enddate);
    if (usage.reads > 0 || usage.writes > 0)
      usage.last_used = new Date();
    else
      usage.last_used = null;

    var postOptions = {
      url: config.joola.engine + '/system/version?APIToken=' + config.joola.apitoken,
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
      usage.version = results.version;
      usage.sdk_version = results.sdk_version;
      return callback(null, usage);
    });
  });
}

function collectJoolaUsage(callback) {
  var hostname = config.hostname || os.hostname();
  hostname = hostname.replace('.c.integrated-net-594.internal', '').substring(2);
  hostname = hostname.substring(0, hostname.length - 2);

  if (!config.joola.apitoken) {
    return fetchAPIToken(hostname, function (err, token) {
      config.joola.apitoken = token;
      collect();
    });
  }
  return collect();

  function collect() {
    var usage = {
      uid: hostname,
      version: 0,
      sdk_version: 0,
      writes: 0,
      reads: 0,
      simple: 0,
      last_used: 0
    };
    return fetchJoolaStatsToken(function (err, token) {
      if (err)
        throw err;
      return queryJoola(token, function (err, usage_joola) {
        if (err)
          throw err;

        usage = util._extend(usage, usage_joola);
        return callback(null, usage);
      });
    });
  }
}

function postJoolaUsage(usage, callback) {
  var postOptions = {
    url: config.cnc.engine + '/api/applications/usage?APIToken=' + config.cnc.apitoken,
    headers: {
      'Content-Type': 'application/json'
    },
    method: "POST",
    json: usage,
    rejectUnauthorized: false,
    requestCert: true,
    agent: false
  };

  request(postOptions, function (error, response, body) {
    if (error)
      throw error;

    return callback(null);
  });
}

function saveTimestamp(ts) {
  var outputFilename = './last_timestamp.json';

  fs.writeFile(outputFilename, JSON.stringify({timestamp: ts}, null, 4), function (err) {
    if (err) {
      console.log(err);
    } else {
      console.log("JSON saved to " + outputFilename);
    }
  });
}
  