# couchbase-driver

An improved version of the official Couchbase driver.

## Installation

`npm install couchbase-driver`

## Overview

A simple alternative driver for [Couchbase](http://docs.couchbase.com/sdk-api/couchbase-node-client-2.1.4/) that wraps the `Bucket` from existing driver with the following modifications:

* `get` works on a single key or an array of keys, calling `Bucket.getMulti` if appropriate. Automatically handles
*key not found* errors and doesn't return an error in that scenario. In case of multiple keys, optionally returns an
array of missing keys.
* `remove` also handles *key not found* errors more gracefully.
* `getAndLock` also handles *key not found* errors more gracefully.
* adds `atomic` function that tries to do perform `getAndLock` + `transform` + specified database operation utilizing `CAS`
in one step until success or maximum retries have occurred. By default we use `getAndLock` to lock the document while we
transform and perform document operation and unlock. Optionally we can use normal `get` function.
* adds <code>Promise</code> support so that functions call be called with either Node-style callbacks or with Promises.

## Usage

Creating:

```js
const couchbase = require('couchbase');
const Driver = require('couchbase-driver');
const cluster = new couchbase.Cluster('couchbase://127.0.0.1');
const bucket = cluster.openBucket('default');
const driver = Driver.create(bucket);
```

Simple retrieval:

```js
driver.get('my_doc_key', (err, res) => {
  if (err) return console.log(err)
  console.dir(res.value)
});
```

If key does not exist `err` *and* `res` will be undefined.

Getting multiple documents:

```js
driver.get(['my_doc_key_1', 'my_doc_key_2', 'my_missing_doc_key_3'], (err, results, missing) => {
  if (err) return console.log(err);
  if (mising.length > 0) console.dir(missing); // ['my_missing_doc_key_3']
  console.dir(res.value);
});
```

"Atomic" transformations can be achieved using the `atomic` function which attempts to do `get` + `transform` +
specified database operation where `CAS` in `get` and the final operation have to match. This uses [`async.retry`](http://caolan.github.io/async/docs.html#.retry) until successful or maximum retries have occurred,
which can be specified in the `Driver` construction or as function option parameter.

```js
function transform(doc) {
  doc.foo = 'bar';
  return {
    value: doc,
    action: Driver.OPERATIONS.UPSERT
  };
}

driver.atomic('my_doc_key', transform, (err, res) => {
  if(err) return console.dir(err);
  console.dir(res);
});
```

With promises:

```js
const result = await driver.get('mykey');
console.dir(result.value); // document
```

Note that with Promise style call and multiple keys we do not get misses.

```js
const results = await driver.get(['mykey1', 'mykey2']);
console.dir(_.map(results, 'value')); // array of documents
```

## API Reference

<a name="Driver"></a>

### Driver
A simple alternative driver for Couchbase that wraps the `Bucket` from existing driver and improves
<code>get</code> and <code>remove</code> methods and adds <code>atomic</code> method.

**Kind**: global class  

* [Driver](#Driver)
    * [new Driver(bucket, options)](#new_Driver_new)
    * _instance_
        * [.OPERATIONS](#Driver+OPERATIONS)
        * [.get(keys, options, fn)](#Driver+get)
        * [.getAndLock(key, options, fn)](#Driver+getAndLock)
        * [.remove(key, options, fn)](#Driver+remove)
        * [.atomic(key, transform, options, fn)](#Driver+atomic)
    * _static_
        * [.OPERATIONS](#Driver.OPERATIONS)
        * [.OPERATIONS](#Driver.OPERATIONS) : <code>enum</code>
        * [.isKeyNotFound(err)](#Driver.isKeyNotFound)
        * [.create(bucket, options)](#Driver.create) ⇒ [<code>Driver</code>](#Driver)

<a name="new_Driver_new"></a>

#### new Driver(bucket, options)
Constructs the new instance. This should not be called directly, but rather use <code>Driver.create()</code>.


| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>Object</code> | the Couchbase <code>Bucket</code> |
| options | <code>Object</code> | Options |
| options.atomicRetryTimes | <code>Number</code> | The number of attempts to make within <code>atomic()</code>.                                            See <code>async.retry</code>. Default: <code>5</code>. |
| options.atomicRetryInterval | <code>Number</code> | The time to wait between retries, in milliseconds, within <code>atomic()</code>.                                               See <code>async.retry</code>. Default: <code>0</code>. |
| options.atomicLock | <code>Boolean</code> | Wether to use <code>getAndLock</code> in <code>atomic()</code> or just the                                       standard <code>get</code>. Default: <code>true</code>. |
| options.missing | <code>Boolean</code> | Whether to return missing. If <code>false</code> Does not return.                                    Useful for certain contexts. Defalt: <code>true</code>. |

<a name="Driver+OPERATIONS"></a>

#### driver.OPERATIONS
Get operation enums

**Kind**: instance property of [<code>Driver</code>](#Driver)  
**Example**  
```js
const Driver = require('couchbase-driver');
const driver = Driver.create(bucket);
console.log(driver.OPERATIONS.UPSERT);
```
<a name="Driver+get"></a>

#### driver.get(keys, options, fn)
A simplified get. Properly handles key not found errors. In case of multi call, returns array of found
and an array of misses.

**Kind**: instance method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| keys | <code>String</code> \| <code>Array</code> | a single key or multiple keys |
| options | <code>Object</code> | Options for bucket <code>get</code> function |
| options.missing | <code>Boolean</code> | Whether to return missing. If <code>false</code> Does not return.                                    Useful for certain contexts. This option takes presidence over the one set in                                    constructor. Default: <code>true</code>. |
| fn | <code>function</code> | callback |

**Example**  
```js
driver.get('my_doc_key', (err, res) => {
  if (err) return console.log(err)
  console.dir(res.value)
}
```
**Example**  
```js
driver.get(['my_doc_key_1', 'my_doc_key_2', 'my_missing_doc_key_3'], (err, results, missing) => {
  if (err) return console.log(err);
  if (mising.length > 0) console.dir(missing); // ['my_missing_doc_key_3']
  console.dir(res.value);
});
```
<a name="Driver+getAndLock"></a>

#### driver.getAndLock(key, options, fn)
Our implementation of <code>Bucket.getAndLock</code> that properly ignores key not found errors.

**Kind**: instance method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | document key to get and lock |
| options | <code>Object</code> | Options to pass to <code>Bucket.getAndLock</code> |
| fn | <code>function</code> | callback |

**Example**  
```js
driver.getAndLock('my_doc_key', (err, res) => {
  if (err) return console.log(err);
  console.dir(res.value)
});
```
<a name="Driver+remove"></a>

#### driver.remove(key, options, fn)
Our implementation of <code>Bucket.remove</code> that properly ignores key not found errors.

**Kind**: instance method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | document key to remove |
| options | <code>Object</code> | Options to pass to <code>Bucket.remove</code> |
| fn | <code>function</code> | callback |

**Example**  
```js
driver.remove('my_doc_key', (err, res) => {
  if (err) return console.log(err);
});
```
<a name="Driver+atomic"></a>

#### driver.atomic(key, transform, options, fn)
Performs an "atomic" operation where it tries to first get the document given the <code>key</code>, then perform
the function <code>transform</code> on the value and then write using the CAS value in the <code>upsert</code>.
If the final document operation fails due to a <code>CAS</code> error, the whole process is retried.

**Kind**: instance method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | document key |
| transform | <code>function</code> | synchronous function to be performend on the document value. Function accepts the                               document or <code>undefined</code> if the document was not found. The function                               should perform any necessary mutation and return an object with <code>value</code>                               and <code>action</code>. <code>value</code> is the new value of the document.                               <code>action</code> should be one of <code>OPERATIONS</code> specifying the action                               to take with the new value. |
| options | <code>String</code> | Options |
| options.atomicRetryTimes | <code>Number</code> | The number of attempts to make within <code>atomic()</code>.                                            See <code>async.retry</code>. Default: <code>5</code>. |
| options.atomicRetryInterval | <code>Number</code> | The time to wait between retries, in milliseconds, within <code>atomic()</code>.                                               See <code>async.retry</code>. Default: <code>0</code>. |
| options.atomicLock | <code>Boolean</code> | Wether to use <code>getAndLock</code> in <code>atomic()</code> or just the                                       standard <code>get</code>. Default: <code>true</code>. |
| options.saveOptions | <code>Object</code> | bucket save options |
| fn | <code>function</code> | callback |

**Example**  
```js
function transform(doc) {
  doc.foo = 'bar';
  return {
    value: doc,
    action: OPERATIONS.UPSERT
  };
}

driver.atomic('my_doc_key', transform, (err, res) => {
  if(err) return console.dir(err);
  console.dir(res);
});
```
<a name="Driver.OPERATIONS"></a>

#### Driver.OPERATIONS
Get operation enums

**Kind**: static property of [<code>Driver</code>](#Driver)  
**Example**  
```js
const Driver = require('couchbase-driver');
console.log(Driver.OPERATIONS.UPSERT);
```
<a name="Driver.OPERATIONS"></a>

#### Driver.OPERATIONS : <code>enum</code>
Enum for Database operations

**Kind**: static enum of [<code>Driver</code>](#Driver)  
**Read only**: true  
**Properties**

| Name | Type | Default | Description |
| --- | --- | --- | --- |
| UPSERT | <code>string</code> | <code>&quot;upsert&quot;</code> | Upsert operation |
| REMOVE | <code>string</code> | <code>&quot;remove&quot;</code> | Remove operation |
| NOOP | <code>string</code> | <code>&quot;noop&quot;</code> | No operation or action |

<a name="Driver.isKeyNotFound"></a>

#### Driver.isKeyNotFound(err)
Determines if error is a "key not found" error

**Kind**: static method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| err | <code>Error</code> | the error to check |

**Example**  
```js
Driver.isKeyNotFound(err);
```
<a name="Driver.create"></a>

#### Driver.create(bucket, options) ⇒ [<code>Driver</code>](#Driver)
Create a Driver object by wrapping the Couchbase bucket and creates a new <code>Driver</code> instance and
adds <code>Promise</code> support to the instance.

**Kind**: static method of [<code>Driver</code>](#Driver)  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>Object</code> | The Couchbase <code>Bucket</code> instance to wrap. |
| options | <code>Object</code> | Options |
| options.atomicRetryTimes | <code>Number</code> | The number of attempts to make within <code>atomic()</code>.                                            See <code>async.retry</code>. Default: <code>5</code>. |
| options.atomicRetryInterval | <code>Number</code> | The time to wait between retries, in milliseconds, within <code>atomic()</code>.                                               See <code>async.retry</code>. Default: <code>0</code>. |
| options.atomicLock | <code>Boolean</code> | Wether to use <code>getAndLock</code> in <code>atomic()</code> or just the                                       standard <code>get</code>. Default: <code>true</code>. |

**Example**  
```js
const couchbase = require('couchbase');
const Driver = require('couchbase-driver');
const cluster = new couchbase.Cluster('couchbase://127.0.0.1');
const bucket = cluster.openBucket('default');
const driver = Driver.create(bucket);
```
## Debug logging

[debug](https://npmjs.com/package/debug) package is used for debug logging.

```sh
DEBUG=couchbase-driver node app.js
```

## License

Copyright 2015 Bojan D.

Licensed under the MIT License.
