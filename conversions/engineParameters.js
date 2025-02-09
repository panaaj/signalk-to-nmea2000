const _ = require('lodash')

const DEFAULT_TIMEOUT = 10000  // ms

module.exports = (app, plugin) => {

  // discrete status fields are not yet implemented
  const engParKeys = [
      'oilPressure',
      'oilTemperature',
      'temperature',
      'alternatorVoltage',
      'fuel.rate',
      'runTime',
      'coolantPressure',
      'fuel.pressure',
      'engineLoad',
      'engineTorque'
  ]

  const engRapidKeys = [
    'revolutions',
    'boostPressure',
    'drive.trimState'
  ]

  return [{
    title: 'Temperature, exhaust (130312)',
    optionKey: 'EXHAUST_TEMPERATURE',
    context: 'vessels.self',
    properties: {
      engines: {
        title: 'Engine Mapping',
        type: 'array',
        items: {
          type: 'object',
          properties: {
            signalkId: {
              title: 'Signal K engine id',
              type: 'string'
            },
            tempInstanceId: {
              title: 'NMEA2000 Temperature Instance Id',
              type: 'number'
            }
          }
        }
      }
    },

    conversions: (options) => {
      if ( !_.get(options, 'EXHAUST_TEMPERATURE.engines') ) {
        return null
      }
      return options.EXHAUST_TEMPERATURE.engines.map(engine => {
        return {
          keys: [
            `propulsion.${engine.signalkId}.exhaustTemperature`
          ],
          callback: (temperature) => {
            return [{
              pgn: 130312,
              SID: 0xff,
              "Temperature Instance": engine.tempInstanceId,
              "Instance": engine.tempInstanceId,
              "Temperature Source": 14,
              "Actual Temperature": temperature,
            }]
          }
        }
      })
    }
  },
  {
    title: 'Engine Parameters (127489,127488)',
    optionKey: 'ENGINE_PARAMETERS',
    context: 'vessels.self',
    properties: {
      engines: {
        title: 'Engine Mapping',
        type: 'array',
        items: {
          type: 'object',
          properties: {
            signalkId: {
              title: 'Signal K engine id',
              type: 'string'
            },
            instanceId: {
              title: 'NMEA2000 Engine Instance Id',
              type: 'number'
            }
          }
        }
      }
    },

    conversions: (options) => {
      if ( !_.get(options, 'ENGINE_PARAMETERS.engines') ) {
        return null
      }
      const dyn = options.ENGINE_PARAMETERS.engines.map(engine => {
        return {
          keys: engParKeys.map(key => `propulsion.${engine.signalkId}.${key}`),
          timeouts: engParKeys.map(key => DEFAULT_TIMEOUT),
          callback: (oilPres, oilTemp, temp, altVolt, fuelRate, runTime, coolPres, fuelPres, engLoad, engTorque) => {
            return [{
                pgn: 127489,
                "Engine Instance": engine.instanceId,
                "Instance": engine.instanceId,
                "Oil pressure": oilPres === null ? undefined : oilPres / 100,
                "Oil temperature": oilTemp === null ? undefined : oilTemp,
                "Temperature": temp === null ? undefined : temp,
                "Alternator Potential": altVolt === null ? undefined : altVolt,
                "Fuel Rate": fuelRate ===null ? undefined : fuelRate / 3600 * 1000,
                "Total Engine hours": runTime === null ? undefined : runTime,
                "Coolant Pressure": coolPres === null ? undefined : coolPres / 100,
                "Fuel Pressure": fuelPres === null ? undefined : fuelPres / 100,
                "Discrete Status 1": [],
                "Discrete Status 2": [],
                "Percent Engine Load": engLoad === null ? undefined : engLoad * 100,
                "Percent Engine Torque": engTorque === null ? undefined : engTorque * 100
            }]
          }
        }
      })

      const rapid = options.ENGINE_PARAMETERS.engines.map(engine => {
        return {
          keys: engRapidKeys.map(key => `propulsion.${engine.signalkId}.${key}`),
          timeouts: engRapidKeys.map(key => DEFAULT_TIMEOUT),
          callback: (revolutions, boostPressure, trimState) => {
            return [{
                pgn: 127488,
                "Engine Instance": engine.instanceId,
                "Instance": engine.instanceId,
                "Speed": revolutions === null ? undefined : revolutions * 60,
                "Boost Pressure": boostPressure === null ? undefined : boostPressure / 100,
                "Tilt/Trim": trimState === null ? undefined : trimState * 100
            }]
          }
        }
      })

      return dyn.concat(rapid)
    }
  }]
}
