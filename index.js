const Bacon = require("baconjs");
const debug = require("debug")("signalk:signalk-to-nmea2000");
const util = require("util");
const toPgn = require("to-n2k").toPgn;
const _ = require('lodash')
const path = require('path')
const fs = require('fs')

module.exports = function(app) {
  var plugin = {};
  var unsubscribes = [];
  var timers = []
  var conversions = load_conversions(app, plugin)
  conversions = [].concat.apply([], conversions)

  /*
    Each conversion can specify the sourceType and outputType.

    Source type can be:

      onDelta - You will get all deltas via app.signalk.on('delta', ...). Please do no use this unless absolutely necessary.
      
      bacanjs - The conversion should specify a variable called 'keys' which is an array of the Signal K paths that the convesion needs

      timer - The conversions callback will get called per the givien 'interval' variable

    Output type can be:

      'to-n2k' - The outut will be sent through the to-n2k package (https://github.com/tkurki/to-n2k)

      'buffer' - The output should be a buffer that is sent directly to nmea2000out

    sourceType defaults to 'bacanjs'
    outputType defaults to 'to-n2k'
   */

  var sourceTypes = {
    'onDelta': mapOnDelta,
    'baconjs': mapBaconjs,
    'timer': mapTimer
  }

  var outputTypes = {
    'to-n2k': processToN2K,
    'buffer': processBufferOutput
  }

  plugin.id = "sk-to-nmea2000";
  plugin.name = "Convert Signal K to NMEA2000";
  plugin.description = "Plugin to convert Signal K to NMEA2000";

  var schema = {
    type: "object",
    title: "Conversions to NMEA2000",
    description:
    "If there is SignalK data for the conversion generate the following NMEA2000 pgns from Signal K data:",
    properties: {}
  };
  
  updateSchema()
  
  function updateSchema() {
    conversions.forEach(conversion => {
      var obj =  {
        type: 'object',
        title: conversion.title,
        properties: {
          enabled: {
            title: 'Enabled',
            type: 'boolean',
            default: false
          }
        }
      }
      
      schema.properties[conversion.optionKey] = obj
      
      if ( conversion.properties ) {
        var props = typeof conversion.properties === 'function' ? conversion.properties() : conversion.properties
        _.extend(obj.properties, props)
      }
    })
  }

  plugin.schema = function() {
    updateSchema()
    return schema
  }
  
  plugin.start = function(options) {
    debug("start");

    conversions.forEach(conversion => {
      if ( !_.isArray(conversion) ) {
        conversion = [ conversion ]
      }
      conversion.forEach(conversion => {
        if ( options[conversion.optionKey] && options[conversion.optionKey].enabled ) {
          debug(`${conversion.title} is enabled`)
          var type = _.isUndefined(conversion.sourceType) ? 'baconjs' : conversion.sourceType
          var mapper = sourceTypes[type]
          if ( _.isUndefined(mapper) ) {
            console.error(`Unknown conversion type: ${type}`)
          } else {
            if ( _.isUndefined(conversion.outputType) ) {
              conversion.outputType = 'to-n2k'
          }
            mapper(conversion, options)
          }
        }
      })
    })
  };

  plugin.stop = function() {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    timers.forEach(timer => clearInterval(timer))
    timers = []
  };

  return plugin;

  function toActisenseSerialFormat(pgn, data, dst) {
    dst = _.isUndefined(dst) ? '255' : dst
    return (
      new Date().toISOString() +
        ",2," +
        pgn +
        `,0,${dst},` +
        data.length +
        "," +
        new Uint32Array(data)
        .reduce(function(acc, i) {
          acc.push(i.toString(16));
          return acc;
        }, [])
        .map(x => (x.length === 1 ? "0" + x : x))
        .join(",")
    );
  }

  function load_conversions (app, plugin) {
    fpath = path.join(__dirname, 'conversions')
    files = fs.readdirSync(fpath)
    return files.map(fname => {
      pgn = path.basename(fname, '.js')
      return require(path.join(fpath, pgn))(app, plugin);
    }).filter(converter => { return typeof converter !== 'undefined'; });
  }

  function processBufferOutput(pgns) {
    if ( pgns ) {
      pgns.filter(pgn => pgn != null).forEach(pgn => {
        try {
          const msg = toActisenseSerialFormat(pgn.pgn, pgn.buffer);
          debug("emit " + msg);
          app.emit("nmea2000out", msg);
        } catch ( err ) {
          console.error(`error writing pgn ${JSON.stringify(pgn)}`)
          console.error(err.stack)
        }
      })
    }
  }

  function processToN2K(pgns) {
    if ( pgns ) {
      pgns.filter(pgn => pgn != null).forEach(pgn => {
        try {
          const msg = toActisenseSerialFormat(pgn.pgn, toPgn(pgn));
          debug("emit " + msg);
          app.emit("nmea2000out", msg);
        }
        catch ( err ) {
          console.error(`error writing pgn ${JSON.stringify(pgn)}`)
          console.error(err.stack)
        }
      })
    }
  }

  function processOutput(conversion, output) {
    outputTypes[conversion.outputType](output)
  }

  function mapBaconjs(conversion) {
    unsubscribes.push(
      Bacon.combineWith(
        conversion.callback,
        conversion.keys.map(app.streambundle.getSelfStream, app.streambundle)
      )
        .changes()
        .debounceImmediate(20)
        .onValue(pgns => {
          processOutput(conversion, pgns)
        })
    );
  }
  
  function mapOnDelta(conversion) {
    app.signalk.on('delta', (delta) => {
      try {
        processOutput(conversion, conversion.callback(delta))
      } catch ( err ) {
        console.log(err)
      }
    })
  }

  function mapTimer(conversion) {
    timers.push(setInterval(() => {
      processOutput(conversion, conversion.callback(app))
    }, conversion.interval));
  }

  function subscription_error(err)
  {
    console.log("error: " + err)
  }
  
  function mapSubscription(mapping, options) {
    var subscription = {
      "context": mapping.context,
      subscribe: []
    }

    var keys = _.isFunction(mapping.keys) ? mapping.keys(options) : keys
    keys.forEach(key => {
      subscription.subscribe.push({ path: key})
    });

    debug("subscription: " + JSON.stringify(subscription))

    app.subscriptionmanager.subscribe(
      subscription,
      unsubscribes,
      subscription_error,
      delta => {
        try {
          processToPGNs(mapping.callback(delta, options))
        } catch ( err ) {
          console.log(err)
        }
      });
  }
};

