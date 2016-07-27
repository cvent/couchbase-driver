import _ from 'lodash';
import async from 'async';
import bluebird from 'bluebird';
import { errors } from 'couchbase';

const debug = require('debug')('couchbase-driver');

/**
 * Enum for Database operations
 * @readonly
 * @enum {string}
 */
const DBOPS = {
  /** Upsert operation */
  UPSERT: 'upsert',
  /** Remove operation */
  REMOVE: 'remove',
  /** No operation or action */
  NOOP: 'noop'
};

const defaultOptions = {
  atomicRetryTimes: 5,
  atomicRetryInterval: 0,
  missing: true
};

class Driver {

  /**
   * @classdesc A simple alternative driver for Couchbase that wraps the `Bucket` from existing driver and improves
   * <code>get</code> and <code>remove</code> methods and adds <code>atomic</code> method.
   *
   * @description
   * Constructs the new instance. This should not be called directly, but rather use <code>create()</code>.
   *
   * @param {Object} bucket the Couchbase <code>Bucket</code>
   * @param options {Object} Options
   * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
   *                                             	 See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
   *                                             	 See <code>async.retry</code>. Default: <code>0</code>.
   * @param {Boolean} options.missing - Whether to return missing. If <code>false</code> Does not return.
   *                                    Useful for certain contexts.
   */
  constructor(bucket, options) {
    this.bucket = bucket;
    this.config = _.defaults(options || {}, defaultOptions);
  }

  /**
   * Get operation enums
   * @example
   * driver.DBOPS.UPSERT;
   */
  get OPERATIONS() {
    return DBOPS;
  }

  /**
   * Get operation enums
   * @example
   * Driver.DBOPS.UPSERT;
   */
  static get OPERATIONS() {
    return DBOPS;
  }

  /**
   * Determines if error is a "key not found" error
   * @param {Error} err - the error to check
   * @example
   * Driver.isKeyNotFound(err);
   */
  static isKeyNotFound(err) {
    let keyNotFound = false;
    if (err && _.isObject(err)) {
      if (err.code && err.code === errors.keyNotFound) {
        keyNotFound = true;
      } else if (err.message && err.message === 'key not found') {
        keyNotFound = true;
      } else if (err.message && err.message.indexOf('key does not exist') >= 0) {
        keyNotFound = true;
      } else if (err.message && err.message.indexOf('key not found') >= 0) {
        keyNotFound = true;
      } else if (err.code && err.code.toString() === '13') {
        keyNotFound = true;
      }
    }

    return keyNotFound;
  }

  /**
   * A simplified get. Properly handles key not found errors. In case of multi call, returns array of found
   * and an array of misses.
   * @param {String|Array} keys - a single key or multiple keys
   * @param {Object} options - Options for bucket <code>get</code> function
   * @param {Boolean} options.missing - Whether to return missing. If <code>false</code> Does not return.
   *                                    Useful for certain contexts. This option takes presidence over the one set in
   *                                    constructor.
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
  get(keys, options, fn) {
    if (options instanceof Function) {
      fn = options;
      options = {};
    }

    if (!fn) {
      fn = _.noop;
    }

    if (!keys || (Array.isArray(keys) && !keys.length)) {
      return process.nextTick(() => {
        return fn();
      });
    }

    if (Array.isArray(keys)) {
      debug(`driver.getMulti. keys: ${keys}`);
      this.bucket.getMulti(keys, (err, getRes) => {
        if (err && _.isObject(err)) {
          return fn(err);
        }

        const misses = [];
        const results = [];
        let errors = [];

        keys.forEach(k => {
          if (getRes.hasOwnProperty(k) && getRes[k]) {
            if (getRes[k].value) {
              results.push({
                value: getRes[k].value,
                cas: getRes[k].cas
              });
            } else if (getRes[k].error && Driver.isKeyNotFound(getRes[k].error)) {
              misses.push(k);
            } else if (getRes[k].error) {
              errors.push([getRes[k].error]);
            }
          }
        });

        if (errors.length === 0) {
          errors = null;
        }

        if (this.config.missing === false) {
          if (options.missing === true) {
            return fn(err, results, misses);
          }

          return fn(err, results);
        }

        if (options.missing === false) {
          return fn(err, results);
        }

        return fn(errors, results, misses);
      });
    } else {
      debug(`driver.get. keys: ${keys}`);
      this.bucket.get(keys, options, (err, getRes) => {
        if (err && Driver.isKeyNotFound(err)) {
          err = null;
        }

        return fn(err, getRes);
      });
    }
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
  remove(key, options, fn) {
    if (options instanceof Function) {
      fn = options;
      options = {};
    }

    if (!fn) {
      fn = _.noop;
    }

    if (!key) {
      return process.nextTick(() => {
        return fn();
      });
    }

    debug(`Driver.remove. key: ${key}`);
    this.bucket.remove(key, options, (err, rres) => {
      if (err && Driver.isKeyNotFound(err)) {
        err = null;
      }

      return fn(err, rres);
    });
  }

  /**
   * Performs an "atomic" operation where it tries to first get the document given the <code>key</code>, then perform
   * the function <code>transform</code> on the value and then write using the CAS value in the <code>upsert</code>.
   * If the upsert fails due to a CAS value error, the whole process is retried.
   * @param {String} key - document key
   * @param {Function} transform - synchronous function to be performend on the document value. Function accepts the
   *                               document or <code>undefined</code> if the document was not found. The function
   *                               should perform any necessary mutation and return an object with <code>value</code>
   *                               and <code>action</code>. <code>value</code> is the new value of the document.
   *                               <code>action</code> should be one of <code>Driver.DBOPS</code> specifying the action
   *                               to take with the new value.
   * @param {String} options - Options
   * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
   *                                             	 See <code>async.retry</code>. Default: <code>5</code>.
   * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
   *                                             	 See <code>async.retry</code>. Default: <code>0</code>.
   * @param {Function} fn - callback
   * @example
   * function transform(doc) {
   *   doc.foo = 'bar';
   *   return {
   *     value: doc,
   *     action: Driver.DBOPS.UPSERT
   *   };
   * }
   *
   * driver.atomic('my_doc_key', transform, (err, res) => {
   *   if(err) return console.dir(err);
   *   console.dir(res);
   * });
   */
  atomic(key, transform, options, fn) {
    if (options instanceof Function) {
      fn = options;
      options = {};
    }

    const retryOptions = _.defaults(options || {}, this.config);

    async.retry(retryOptions, rfn => {
      this.get(key, (err, doc) => {
        if (err) {
          return rfn(err);
        }

        const opr = transform(doc ? doc.value : undefined);
        const opts = doc ? { cas: doc.cas } : {};
        if (opr.action === DBOPS.NOOP) {
          return rfn(null, opr.value);
        } else if (opr.action === DBOPS.UPSERT && opr.value) {
          return this.bucket.upsert(key, opr.value, opts, rfn);
        }
        return this.bucket.remove(key, opts, rfn);
      });
    }, fn);
  }
}

/**
 * Create a Driver object by wrapping the Couchbase bucket and creates a new <code>Driver</code> instance and
 * adds <code>Promise</code> support to the instance.
 * @param bucket {Object} The Couchbase <code>Bucket</code> instance to wrap.
 * @param options {Object} Options
 * @param {Number} options.atomicRetryTimes - The number of attempts to make within <code>atomic()</code>.
 *                                             	 See <code>async.retry</code>. Default: <code>5</code>.
 * @param {Number} options.atomicRetryInterval - The time to wait between retries, in milliseconds, within <code>atomic()</code>.
 *                                             	 See <code>async.retry</code>. Default: <code>0</code>.
 * @returns {Driver}
 * @example
 * const couchbase = require('couchbase');
 * const create = require('couchbase-driver');
 * const cluster = new couchbase.Cluster('couchbase://127.0.0.1');
 * const bucket = cluster.openBucket('default');
 * const driver = create(bucket);
 */
export function create(bucket, options) {
  // wrap the class
  const bucketPrototype = Object.getPrototypeOf(bucket);
  let fnNames = [];
  let p;
  for (p in bucketPrototype) {
    if (bucketPrototype.hasOwnProperty(p) && p.charAt(0) !== '_' &&
      typeof bucketPrototype[p] === 'function' && !Driver.prototype[p]) {
      fnNames.push(p);
    }
  }

  fnNames.forEach(fnName => {
    Driver.prototype[fnName] = function () {
      this.bucket[fnName](...arguments);
    };
  });

  // craete the instance
  const d = new Driver(bucket, options);

  // Promisify the instance to allow both callback and Promise based invokation
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(d));
  fnNames = _.filter(names, name => {
    return typeof Driver.prototype[name] === 'function' && name !== 'constructor';
  });

  fnNames.forEach(name => {
    const originalFn = d[name];
    d[name] = function () {
      const lastArg = arguments[arguments.length - 1];
      return bluebird.promisify(originalFn, { context: d })(...arguments).asCallback(lastArg, { spread: true });
    };
  });

  return d;
}
