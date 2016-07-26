# couchbase-driver

An improved version of the official Couchbase driver.

## API Reference

<a name="OPERATIONS"></a>

### OPERATIONS
Get operation enums

**Kind**: global variable  
<a name="OPERATIONS"></a>

### OPERATIONS
Get operation enums

**Kind**: global variable  
<a name="isKeyNotFound"></a>

### isKeyNotFound()
Determines if error is a "key not found" error

**Kind**: global function  
<a name="get"></a>

### get(keys, options, fn)
A simplified get. Properly handles key not found errors. In case of multi call, returns array of found
and an array of misses.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| keys | <code>String</code> &#124; <code>Array</code> | a single key or multiple keys |
| options | <code>Object</code> | Options for bucket <code>get</code> function |
| options.missing | <code>Boolean</code> | Whether to return missing. If <code>false</code> Does not return.                                    Useful for certain contexts. This option takes presidence over the one set in                                    constructor. |
| fn | <code>function</code> | callback |

<a name="remove"></a>

### remove(key, options, fn)
Our implementation of Bucket.remove that properly ignores key not found errors.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | document key to remove |
| options | <code>Object</code> | Options to pass to Bucket.remove |
| fn | <code>function</code> | callback |

<a name="atomic"></a>

### atomic(key, transform, options, fn)
Performs an "atomic" operation where it tries to first get the document given the <code>key</code>, then perform
the function <code>transform</code> on the value and then write using the CAS value in the <code>upsert</code>.
If the upsert fails due to a CAS value error, the whole process is retried.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| key | <code>String</code> | document key |
| transform | <code>function</code> | synchronous function to be performend on the document value |
| options | <code>String</code> | Options |
| options.atomicRetryTimes | <code>Number</code> | The number of attempts to make within <code>atomic()</code>.                                             	 See <code>async.retry</code>. Default: <code>5</code>. |
| options.atomicRetryInterval | <code>Number</code> | The time to wait between retries, in milliseconds, within <code>atomic()</code>.                                             	 See <code>async.retry</code>. Default: <code>0</code>. |
| fn | <code>function</code> | callback |

<a name="create"></a>

### create(bucket, options) ⇒ <code>Driver</code>
Create a Driver object by wrapping the Couchbase bucket and returning a new <code>Driver</code> instance.

**Kind**: global function  

| Param | Type | Description |
| --- | --- | --- |
| bucket | <code>Object</code> | The Couchbase <code>Bucket</code> instance to wrap. |
| options | <code>Object</code> | Options |
| options.atomicRetryTimes | <code>Number</code> | The number of attempts to make within <code>atomic()</code>.                                             	 See <code>async.retry</code>. Default: <code>5</code>. |
| options.atomicRetryInterval | <code>Number</code> | The time to wait between retries, in milliseconds, within <code>atomic()</code>.                                             	 See <code>async.retry</code>. Default: <code>0</code>. |

**Example**  
```js
const cluster = new couchbase.Cluster('couchbase://127.0.0.1');
const bucket = cluster.openBucket('default');
const driver = Driver.create(bucket);
```
