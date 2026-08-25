# velojson
Binary JSON encoder / decoder

Velojson or VSON (aka: Velocity JSON) is a compact binary wire format to encode / decode generic JavaScript-based JSON data, any data representable with JSON in JavaScript is representable with VSON and vice-versa. No additional types or capabilities are added special to the binary format - this is a one-to-one direct mapping.

Example:
```ts
import { VSON } from 'jsr:@velotype/velojson'

const startObj = { name: "Some name", age: 20, address: null }

const objBinary: Uint8Array = VSON.encode(startObj)

console.log(objBinary)
// Expected output: Uint8Array(34) [ 14, 14, 13, 9, 83, 111, 109, 101, 32, 110, 97, 109, 101, 19, 20, 24, 17, 4, 110, 97, 109, 101, 3,  97, 103, 101, 7, 97, 100, 100, 114, 101, 115, 115 ]

const endObj = VSON.decode(objBinary)

console.log(JSON.stringify(endObj))
// Expected output: {"name":"Some name","age":20,"address":null}
```

## Performance:

### For size:
Velojson supports three encoding formats:

#### VSON - Base format:
VSON Base format is moderately compressed compared to JSON, consistenty using fewer bytes in nearly all cases though only by 10%-20% for most objects. This is because the VSON Base format directly replicates the structure of JSON. The advantage of this design is that VSON Base can be used in situations envolving streaming and partial decoding.

#### VSON - Key Table format:
VSON Key Table format is very similar to the Base format however all keys are segregated into a string array appended to the root value and key indexes are used to index into that array. This means that every unique key is encoded only once and depending on the shape of the JSON object this can generate high compression rates, with 50% - 80% size reduction reasonable depending on how many keys are duplicated in the data.

#### VBIN - Key Id format:
The VBIN Key Id format is very similar to the Key Table format however the Key Table is not included in the message. This means that the encoder and decoder need to already have agreed on a Key Id mapping ahead of time to be able to encode/decode messages. VBIN offers only marginal size reduction from the KeyTable format since the KeyTable is skipped (this is usually small), however VBIN offers significant performance improvement because the key names do not need to be encoded/decoded from UTF-8 and used as a string index on the constructed object.

### For timing:
The VSON encodings typically run slower than native `JSON.stringify()` and `JSON.parse()` in most cases (for the specific case of many complex numbers, VSON outperforms - though this is rare).

The VBIN encoding performs significantly faster than native JSON encoding.

## Exported modules:

There are two exported modules:

"@velotype/velojson" - Contains code optimized for speed, designed for server-side usage. This code supports all EncodingFormats (VSON-Base, VSON-KeyTable, and VBIN)

"@velotype/velojson/browser" - Contains code optimized for minified size (~4.3kb). This code supports only the VSON-KeyTable EncodingFormat.

# Format specs:

## VSON - Base Encoding format:

VRoot - `{A: encoding format (0) ++ wire type}{C?: encoded value}`

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

C - any number other than zero or a positive integer is encoded as an 8 byte double in little endian format

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


## VSON - Key Table Encoding format:

VRoot - `{A: encoding format (1) ++ wire type}{C: encoded value}{D: encoded key table}`

VKeyTable - `{L: encoding length}{C: encoded values}`

A - a pos varint constructed by encoding the bits of the encoding format and appending 3 bits representing the wire type of the root value (must be either Object or Array)

C - the encoded value of the root value

D - a homogenous string array of all keys, note this encoding skips the homogenous bit and the wire type varint since both defined for the key table

VStruct - `{A: key index ++ wire type}{C?: encoded value}`

A - a pos varint constructed by encoding the bits of the key index and appending 3 bits representing the wire type, note that the key index is 1-indexed and a key index of zero represents no key

C - the encoded value of the wire type (encoding depends on the wire type)

## VBIN - Key Id Encoding format:

VRoot - `{A: encoding format (2) ++ wire type}{C: encoded value}`

A - a pos varint constructed by encoding the bits of the encoding format and appending 3 bits representing the wire type of the root value (must be either Object or Array)

C - the encoded value of the root value, for VBIN this must be an Object at the root

VStruct - `{A: key index ++ wire type}{C?: encoded value}`

A - a pos varint constructed by encoding the bits of the key index and appending 3 bits representing the wire type, note that the key index is 1-indexed and a key index of zero represents no key

C - the encoded value of the wire type (encoding depends on the wire type)

## Note on the encoding of `undefined`

Encoding and decoding of `undefined` works similarly to `JSON.parse(JSON.stringify(value))`

This means:
* For Objects with a key that has a value of `undefined`, that key is not encoded
  * For example an object like `{ a: 1, b: null, c: undefined }` is encoded the same as `{ a: 1, b: null }`
* For Arrays with a value of `undefined`, that value is mutated to `null`
  * For example an object like `[ 1, null, undefined ]` is encoded the same as `[ 1, null, null ]`
* If `undefined` is passed directly to `encodeVSON()` then that is encoded in zero bytes to represent `undefined`
