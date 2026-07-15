# velojson
Binary JSON encoder / decoder

velojson or VSON is a Binary wire format to encode / decode generic JSON data, any data representable with JSON is representable with VSON and vice-versa.

Example:
```ts
import { encodeVSON, decodeVSON } from 'jsr:@velotype/velojson'

const startObj = { name: "Some name", age: 20, address: null }

const objBinary: Uint8Array = encodeVSON(startObj)

console.log(objBinary)
// Expected output: Uint8Array(30) [ 6, 28, 37, 110, 97, 109, 101, 9, 83, 111, 109, 101, 32, 110, 97, 109, 101, 27, 97, 103, 101, 20, 56, 97, 100, 100, 114, 101, 115, 115 ]

const endObj = decodeVSON(objBinary)

console.log(JSON.stringify(endObj))
// Expected output: {"name":"Some name","age":20,"address":null}
```

## Encoding format:

VStruct - `{A: key length ++ wire type}{B?: key}{C?: encoded value}`

A - a pos varint constructed by encoding the bits of the key length and appending 3 bits representing the wire type

B - UTF-8 encoded string representing the key (if present)

C - the encoded value of the wire type (encoding depends on the wire type)

Native wire types:
* 0 - null
* 1 - boolean false
* 2 - boolean true
* 3 - number (positive integer)
* 4 - number (double)
* 5 - string
* 6 - object
* 7 - array

## Per-value encoding

### 0 - null

`{A: key length ++ 000}{B?: key}`

Note - there is no "encoded value" since the wire type is sufficient

### 1 - boolean false

`{A: key length ++ 001}{B?: key}`

Note - there is no "encoded value" since the wire type is sufficient

### 2 - boolean true

`{A: key length ++ 010}{B?: key}`

Note - there is no "encoded value" since the wire type is sufficient

### 3 - number (positive integer)

`{A: key length ++ 011}{B?: key}{C: encoded value}`

C - a positive integer (or zero) is encoded as a pos varint (1 to 7 bytes)

### 4 - number (double)

`{A: key length ++ 100}{B?: key}{C: encoded value}`

C - any number other than zero or a positive integer is encoded as an 8 byte double

### 5 - string

`{A: key length ++ 101}{B?: key}{C: encoded value}`

C - `{LENGTH}{VALUE?}`

LENGTH is encoded as a pos varint (or zero)

VALUE is a UTF-8 encoded string

### 6 - object

`{A: key length ++ 110}{B?: key}{C: encoded value}`

C - `{LENGTH}{VALUE?}`

LENGTH is encoded as a pos varint (or zero)

VALUE is a series of `VStruct` encoded values with a requirement that all have non-zero key length

### 7 - array

`{A: key length ++ 111}{B?: key}{C: encoded value}`

Arrays are split into two sub-cases: heterogenous arrays and homogenous arrays

Note: the encoder may choose to use either encoding for homogenous arrays.

#### Heterogenous array:
C - `{LENGTH ++ 0}{VALUE?}`

LENGTH is encoded as a pos varint (or zero)

VALUE is a series of `VStruct` encoded values with a requirement that all have zero key length

#### Homogenous array:
C - `{LENGTH ++ 1}{WIRETYPE}{VALUE}`

LENGTH is encoded as a pos varint (or zero)

WIRETYPE is a single byte encoding the wire type of all values in the array

VALUE is a series of `VStruct` encoded values with a requirement that all have zero key length and skip encoding their wire type byte (since they are all homogenous)


## Encoding of `undefined`

Encoding and decoding of `undefined` works similarly to `JSON.parse(JSON.stringify(value))`

This means:
* For Objects with a key that has a value of `undefined`, that key is not encoded
  * For example an object like `{ a: 1, b: null, c: undefined }` is encoded the same as `{ a: 1, b: null }`
* For Arrays with a value of `undefined`, that value is mutated to `null`
  * For example an object like `[ 1, null, undefined ]` is encoded the same as `[ 1, null, null ]`
* If `undefined` is passed directly to `encodeVSON()` then that is encoded in zero bytes to represent `undefined`
