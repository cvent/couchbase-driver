const http = require('http')
const semver = require('semver')
const defaults = require('lodash.defaults')
const async = require('async')
const pCall = require('promisify-call')
const { errors } = require('couchbase')

const debug = require('debug')('couchbase-driver')

/**
 * Enum for Database operations
 * @readonly
 * @enum {string}
 * @memberof Driver
 */
const OPERATIONS = {
  /** Upsert operation */
  UPSERT: 'upsert',
  /** Remove operation */
  REMOVE: 'remove',
  /** No operation or action */
  NOOP: 'noop'
}

const defaultOptions = {
  tempRetryTimes: 5,
  tempRetryInterval: 50,
  retryTemporaryErrors: false,
  atomicRetryTimes: 5,
  atomicRetryInterval: 0,
  atomicLock: true,
  missing: true,
  saveOptions: {}
}

const syncFunctions = [
  'disconnect',
  'invalidateQueryCache',
  'lookupIn',
  'manager',
  'mutateIn',
  'query',
  'setTranscoder',
  'touch'
]

class Driver {
  /**
   * @classdesc A simple alternative driver for Couchbase that wraps the `Bucket` from existing driver and improves
   * <code>get</code> and <code>remove</code> methods and adds <code>atomic</code> method.
   *
   * @description
   * Constructs the new instance. This should not be called directly, but rather use <code>Driver.create()</code>.
   *
   * @param {Object} bucket the Couchbase <code>Bucket</code>
   * @param options {Object} Options
   * @param {Boolean} options.retryTemporaryErrors - Whether to automatically backoff/retry on temporary
   *                                       couchbase errors. Default: <code>false</code>.
   * @param {Number} options.tempRetryTimes - The number of attempts to make when backing off temporary errors.
   *                                            See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.tempRetryInterval - The time to wait between retries, in milliseconds, when backing off temporary errors .
   *                                               See <code>async.retry</code>. Default: <code>50</code>.
   * @param {Boolean} options.atomicLock - Whether to use <code>getAndLock</code> in <code>atomic()</code> or just the
   *                                       standard <code>get</code>. Default: <code>true</code>.
   * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
   *                                            See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
   *                                               See <code>async.retry</code>. Default: <code>0</code>.
   * @param {Boolean} options.atomicLock - Whether to use <code>getAndLock</code> in <code>atomic()</code> or just the
   *                                       standard <code>get</code>. Default: <code>true</code>.
   * @param {Boolean} options.missing - Whether to return missing. If <code>false</code> Does not return.
   *                                    Useful for certain contexts. Defalt: <code>true</code>.
   */
  constructor (bucket, options = {}) {
    this.bucket = bucket
    this.config = defaults(options, defaultOptions)
  }

  /**
   * Get operation enums
   * @example
   * const Driver = require('couchbase-driver');
   * const driver = Driver.create(bucket);
   * console.log(driver.OPERATIONS.UPSERT);
   */
  get OPERATIONS () {
    return OPERATIONS
  }

  /**
   * Get operation enums
   * @example
   * const Driver = require('couchbase-driver');
   * console.log(Driver.OPERATIONS.UPSERT);
   */
  static get OPERATIONS () {
    return OPERATIONS
  }

  /**
   * Determines if error is a "key not found" error
   * @param {Error} err - the error to check
   * @example
   * Driver.isKeyNotFound(err);
   */
  static isKeyNotFound (err) {
    let keyNotFound = false
    if (err && isObject(err)) {
      if (err.code && err.code === errors.keyNotFound) {
        keyNotFound = true
      } else if (err.message && err.message === 'key not found') {
        keyNotFound = true
      } else if (err.message && err.message.indexOf('key does not exist') >= 0) {
        keyNotFound = true
      } else if (err.message && err.message.indexOf('key not found') >= 0) {
        keyNotFound = true
      } else if (err.code && err.code.toString() === '13') {
        keyNotFound = true
      }
    }

    return keyNotFound
  }

  /**
   * Determines if error is a "Temporary" error
   * https://developer.couchbase.com/documentation/server/current/sdk/nodejs/handling-error-conditions.html
   * @param {Error} err - the error to check
   * @example
   * Driver.isTemporaryError(err);
   */
  static isTemporaryError (err) {
    let tempError = false
    if (err && isObject(err)) {
      if (err.code && err.code === errors.temporaryError) {
        tempError = true
      } else if (err.message && err.message.indexOf('Temporary failure') >= 0) {
        tempError = true
      } else if (err.code && err.code.toString() === '11') {
        tempError = true
      }
    }

    return tempError
  }

  /**
   * A simplified get. Properly handles key not found errors. In case of multi call, returns array of found
   * and an array of misses.
   * @param {String|Array} keys - a single key or multiple keys
   * @param {Object} options - Options for bucket <code>get</code> function
   * @param {Boolean} options.missing - Whether to return missing. If <code>false</code> Does not return.
   *                                    Useful for certain contexts. This option takes presidence over the one set in
   *                                    constructor. Default: <code>true</code>.
   * @param {Function} fn callback
   * @example
   * driver.get('my_doc_key', (err, res) => {
   *   if (err) return console.log(err)
   *   console.dir(res.value)
   * }
   * @example
   * driver.get(['my_doc_key_1', 'my_doc_key_2', 'my_missing_doc_key_3'], (err, results, missing) => {
   *   if (err) return console.log(err);
   *   if (mising.length > 0) console.dir(missing); // ['my_missing_doc_key_3']
   *   console.dir(res.value);
   * });
   */
  get (keys, options, fn) {
    return pCall(this, getDocument, ...arguments)
  }

  /**
   * Our implementation of <code>Bucket.getAndLock</code> that properly ignores key not found errors.
   * @param {String} key - document key to get and lock
   * @param {Object} options - Options to pass to <code>Bucket.getAndLock</code>
   * @param {Function} fn - callback
   * @example
   * driver.getAndLock('my_doc_key', (err, res) => {
   *   if (err) return console.log(err);
   *   console.dir(res.value)
   * });
   */
  getAndLock (key, options, fn) {
    return pCall(this, getAndLock, ...arguments)
  }

  /**
   * Our implementation of <code>Bucket.remove</code> that properly ignores key not found errors.
   * @param {String} key - document key to remove
   * @param {Object} options - Options to pass to <code>Bucket.remove</code>
   * @param {Function} fn - callback
   * @example
   * driver.remove('my_doc_key', (err, res) => {
   *   if (err) return console.log(err);
   * });
   */
  remove (key, options, fn) {
    return pCall(this, remove, ...arguments)
  }

  /**
   * Our implementation of <code>Bucket.insert</code> that can recover from temporary errors.
   * @param {String} key - document key to insert
   * @param {String} value - document contents to insert
   * @param {Object} options - Options to pass to <code>Bucket.insert</code>
   * @param {Function} fn - callback
   * @example
   * driver.insert('my_doc_key', "doc_contents", (err, res) => {
   *   if (err) return console.log(err);
   * });
   */
  insert (key, value, options, fn) {
    return pCall(this, insert, ...arguments)
  }

  /**
   * Our implementation of <code>Bucket.upsert</code> that can recover from temporary errors.
   * @param {String} key - document key to upsert
   * @param {String} value - document contents to upsert
   * @param {Object} options - Options to pass to <code>Bucket.upsert</code>
   * @param {Function} fn - callback
   * @example
   * driver.upsert('my_doc_key', "doc_contents", (err, res) => {
   *   if (err) return console.log(err);
   * });
   */
  upsert (key, value, options, fn) {
    return pCall(this, upsert, ...arguments)
  }

  /**
   * Performs an "atomic" operation where it tries to first get the document given the <code>key</code>, then perform
   * the function <code>transform</code> on the value and then write using the CAS value in the <code>upsert</code>.
   * If the final document operation fails due to a <code>CAS</code> error, the whole process is retried.
   * @param {String} key - document key
   * @param {Function} transform - synchronous function to be performend on the document value. Function accepts the
   *                               document or <code>undefined</code> if the document was not found. The function
   *                               should perform any necessary mutation and return an object with <code>value</code>
   *                               and <code>action</code>. <code>value</code> is the new value of the document.
   *                               <code>action</code> should be one of <code>OPERATIONS</code> specifying the action
   *                               to take with the new value.
   * @param {String} options - Options
   * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
   *                                            See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
   *                                               See <code>async.retry</code>. Default: <code>0</code>.
   * @param {Boolean} options.atomicLock - Whether to use <code>getAndLock</code> in <code>atomic()</code> or just the
   *                                       standard <code>get</code>. Default: <code>true</code>.
   * @param {Object} options.saveOptions - bucket save options
   * @param {Function} fn - callback
   * @example
   * function transform(doc) {
   *   doc.foo = 'bar';
   *   return {
   *     value: doc,
   *     action: OPERATIONS.UPSERT
   *   };
   * }
   *
   * driver.atomic('my_doc_key', transform, (err, res) => {
   *   if(err) return console.log(err);
   *   console.dir(res);
   * });
   */
  atomic (key, transform, options, fn) {
    return pCall(this, atomic, ...arguments)
  }

  _atomicWithLock (key, transform, options, fn) {
    return pCall(this, _atomicWithLock, ...arguments)
  }

  _atomicNoLock (key, transform, options, fn) {
    return pCall(this, _atomicNoLock, ...arguments)
  }

  /**
   * Attempts to get the lowest couchbase server version from the nodes in the cluster
   * **Warning**
   * This depends on undocumented internals of Node.js couchbase library
   * @param {Function} fn - callback
   * @example
   * driver.getServerVersion((err, version) => {
   *   if(err) return console.log(err);
   *   console.log(version);
   * });
   */
  getServerVersion (fn) {
    return pCall(this, getServerVersion, ...arguments)
  }

  /**
   * Create a Driver object by wrapping the Couchbase bucket and creates a new <code>Driver</code> instance and
   * adds <code>Promise</code> support to the instance.
   * @param bucket {Object} The Couchbase <code>Bucket</code> instance to wrap.
   * @param options {Object} Options
   * @param {Boolean} options.retryTemporaryErrors - Whether to automatically backoff/retry on temporary
   *                                       couchbase errors. Default: <code>false</code>.
   * @param {Number} options.tempRetryTimes - The number of attempts to make when backing off temporary errors.
   *                                            See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.tempRetryInterval - The time to wait between retries, in milliseconds, when backing off temporary errors .
   *                                               See <code>async.retry</code>. Default: <code>50</code>.
   * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
   *                                            See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
   *                                               See <code>async.retry</code>. Default: <code>0</code>.
   * @param {Boolean} options.atomicLock - Whether to use <code>getAndLock</code> in <code>atomic()</code> or just the
   *                                       standard <code>get</code>. Default: <code>true</code>.
   * @returns {Driver}
   * @example
   * const couchbase = require('couchbase');
   * const Driver = require('couchbase-driver');
   * const cluster = new couchbase.Cluster('couchbase://127.0.0.1');
   * const bucket = cluster.openBucket('default');
   * const driver = Driver.create(bucket);
   */
  static create (bucket, options = {}) {
    // wrap the class
    const bucketPrototype = Object.getPrototypeOf(bucket)
    let fnNames = []
    let p
    for (p in bucketPrototype) {
      if (bucketPrototype.hasOwnProperty(p) &&
        p.charAt(0) !== '_' &&
        typeof bucketPrototype[p] === 'function' &&
        !Driver.prototype[p] &&
        p !== 'constructor') {
        fnNames.push(p)
      }
    }

    fnNames.forEach(fnName => {
      Driver.prototype[fnName] = function () {
        if (syncFunctions.indexOf(p) < 0) {
          return this.bucket[fnName](...arguments)
        } else {
          return pCall(this.bucket, this.bucket[fnName], ...arguments)
        }
      }
    })
    return new Driver(bucket, options)
  }
}

function getDocument (keys, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = { missing: true }
  }

  if (!keys || (Array.isArray(keys) && !keys.length)) {
    return process.nextTick(fn)
  }

  if (Array.isArray(keys)) {
    debug(`Driver.getMulti. keys: ${keys}`)
    this.bucket.getMulti(keys, (err, getRes) => {
      if (err && isObject(err)) {
        return fn(err)
      }

      const misses = []
      const results = []
      let errors = []

      keys.forEach(k => {
        if (getRes.hasOwnProperty(k) && getRes[k]) {
          if (getRes[k].value) {
            results.push({
              value: getRes[k].value,
              cas: getRes[k].cas
            })
          } else if (getRes[k].error && Driver.isKeyNotFound(getRes[k].error)) {
            misses.push(k)
          } else if (getRes[k].error) {
            errors.push([getRes[k].error])
          }
        }
      })

      if (errors.length === 0) {
        errors = null
      }

      if (this.config.missing === false) {
        if (options.missing === true) {
          return fn(errors, results, misses)
        }

        return fn(errors, results)
      }

      if (options.missing === false) {
        return fn(errors, results)
      }

      return fn(errors, results, misses)
    })
  } else {
    debug(`Driver.get. keys: ${keys}`)
    this.bucket.get(keys, options, (err, getRes) => {
      if (err && Driver.isKeyNotFound(err)) {
        err = null
      }

      return fn(err, getRes)
    })
  }
}

function getAndLock (key, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  debug(`Driver.getAndLock. key: ${key}`)

  const opts = defaults(options, this.config)
  const ropts = {
    times: opts.retryTemporaryErrors ? opts.tempRetryTimes : 1,
    interval: options.tempRetryInterval,
    errorFilter: Driver.isTemporaryError
  }

  async.retry(ropts, rFn => {
    this.bucket.getAndLock(key, options, (err, getRes) => {
      if (err && Driver.isKeyNotFound(err)) {
        err = null
      }
      return rFn(err, getRes)
    })
  }, fn)
}

function remove (key, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  if (!key) {
    return process.nextTick(fn)
  }

  debug(`Driver.remove. key: ${key}`)
  this.bucket.remove(key, options, (err, rres) => {
    if (err && Driver.isKeyNotFound(err)) {
      err = null
    }

    return fn(err, rres)
  })
}

function insert (key, value, options, fn) {
  write.apply(this, ['insert', key, value, options, fn])
}

function upsert (key, value, options, fn) {
  write.apply(this, ['upsert', key, value, options, fn])
}

function write (type, key, value, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  if ((type !== 'insert' && type !== 'upsert') ||
    typeof this.bucket[type] !== 'function') {
    return process.nextTick(() => {
      return fn(new Error(`Invalid write operation: ${type}`))
    })
  }

  const opts = defaults(options, this.config)
  const ropts = {
    times: opts.retryTemporaryErrors ? opts.tempRetryTimes : 1,
    interval: options.tempRetryInterval,
    errorFilter: Driver.isTemporaryError
  }

  debug(`Driver.${type}. key: ${key} retry options: %j`, ropts)

  if (!key) {
    return process.nextTick(fn)
  }

  async.retry(ropts, rFn => {
    this.bucket[type](key, value, options, rFn)
  }, fn)
}

function atomic (key, transform, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  debug(`Driver.atomic. key: ${key}`)
  if (options.atomicLock) {
    return this._atomicWithLock(key, transform, options, fn)
  }
  return this._atomicNoLock(key, transform, options, fn)
}

function _atomicWithLock (key, transform, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  const opts = defaults(options, this.config)
  const ropts = {
    times: opts.atomicRetryTimes,
    interval: options.atomicRetryInterval
  }

  debug(`Driver._atomicWithLock. key: ${key} retry options: %j`, ropts)
  async.retry(ropts, rfn => {
    this.getAndLock(key, (err, doc) => {
      if (err) {
        return rfn(err)
      }

      const opr = transform(doc ? doc.value : undefined)
      const opts = doc ? { cas: doc.cas } : {}
      Object.assign(opts, options.saveOptions)
      debug(`Driver.atomicWithLock. action: ${opr.action}`)
      if (opr.action === OPERATIONS.NOOP) {
        if (!doc) {
          return rfn(err, opr.value)
        }
        this.unlock(key, doc.cas, err => {
          return rfn(err, opr.value)
        })
      } else if (opr.action === OPERATIONS.UPSERT && opr.value) {
        // if new document we want to try insert so the op will fail if
        // it got inserted in the meantime by another request
        if (doc) {
          return this.upsert(key, opr.value, opts, rfn)
        }
        return this.insert(key, opr.value, opts, rfn)
      } else {
        this.unlock(key, doc.cas, (err, doc2) => {
          if (err) {
            return rfn(err)
          }
          const ropts = doc2 ? { cas: doc2.cas } : {}
          return this.remove(key, ropts, rfn)
        })
      }
    })
  }, fn)
}

function _atomicNoLock (key, transform, options, fn) {
  if (options instanceof Function) {
    fn = options
    options = {}
  }

  const opts = defaults(options, this.config)
  const ropts = {
    times: opts.atomicRetryTimes,
    interval: options.atomicRetryInterval
  }

  debug(`Driver._atomicNoLock. key: ${key} retry options: %j`, ropts)
  async.retry(ropts, rfn => {
    this.get(key, (err, doc) => {
      if (err) {
        return rfn(err)
      }

      const opr = transform(doc ? doc.value : undefined)
      const opts = doc ? { cas: doc.cas } : {}
      debug(`Driver.atomicNoLock. action: ${opr.action}`)
      if (opr.action === OPERATIONS.NOOP) {
        return rfn(null, opr.value)
      } else if (opr.action === OPERATIONS.UPSERT && opr.value) {
        // if new document we want to try insert so the op will fail if
        // it got inserted in the meantime by another request
        if (doc) {
          return this.upsert(key, opr.value, opts, rfn)
        }
        return this.insert(key, opr.value, rfn)
      }
      return this.remove(key, opts, rfn)
    })
  }, fn)
}

function isObject (value) {
  const type = typeof value
  return value != null && (type === 'object' || type === 'function')
}

function getNodeUri (bucket) {
  if (!bucket ||
    !bucket._cb ||
    !bucket._execAndUriParse ||
    typeof bucket._execAndUriParse !== 'function') {
    return
  }
  const dbnodeFn = bucket._cb.getMgmtNode || bucket._cb.getViewNode
  return bucket._execAndUriParse(dbnodeFn)
}

function getNodeDataRequestOptions (bucket) {
  const nodeUri = getNodeUri(bucket)
  if (!nodeUri) {
    return
  }
  const reqOpts = {
    agent: this.httpAgent,
    hostname: nodeUri.hostname,
    port: nodeUri.port,
    path: '/pools/default',
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  }
  if (this._password) {
    reqOpts.auth = this._username + ':' + this._password
  }
  return reqOpts
}

function getNodeData (bucket, fn) {
  const reqOpts = getNodeDataRequestOptions(bucket)
  if (!reqOpts) {
    return fn(new Error('Could not get server node data'))
  }
  const req = http.request(reqOpts, res => {
    const statusCode = res.statusCode
    let error
    if (statusCode !== 200) {
      error = new Error(`Node request failed. Status Code: ${statusCode}`)
    }

    if (error) {
      res.resume()
      return fn(error)
    }

    res.setEncoding('utf8')
    let rawData = ''
    res.on('data', chunk => { rawData += chunk })
    res.on('end', () => {
      try {
        const parsedData = JSON.parse(rawData)
        return fn(null, parsedData)
      } catch (e) {
        return fn(e)
      }
    })
  })

  req.on('error', (e) => {
    fn(e)
  })

  req.end()
}

function getServerVersion (fn) {
  getNodeData(this.bucket, (err, nodeData) => {
    if (err) {
      return fn(err)
    }
    if (!nodeData ||
      !nodeData.nodes ||
      !Array.isArray(nodeData.nodes) ||
      !nodeData.nodes.length) {
      return fn(new Error('No couchbase server node data'))
    }
    let versions = nodeData.nodes.map(n => n.version)
    versions = versions.map(vStr => {
      const i = vStr.indexOf('-')
      if (i <= 0) {
        return vStr
      }
      return vStr.substring(0, i)
    })
    const version = versions.reduce((lv, v) => {
      if (semver.lt(lv, v)) {
        return lv
      }
      return v
    }, '1000.1000.1000')
    return fn(null, version)
  })
}

module.exports = Driver
