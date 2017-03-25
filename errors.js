const ExtensibleError = require('extensible-error')

exports.MissingParameterError = class MissingParameterError extends ExtensibleError {
  constructor (msg) {
    super(msg || 'Missing a required parameter')
    this.missingParameter = true
  }
}
