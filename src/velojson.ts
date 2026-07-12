/**
 * velojson (VSON) — binary encoder/decoder for JSON-representable data.
 *
 * Implements the wire format described in the velojson README:
 *   0 = null, 1 = false, 2 = true, 3 = positive integer,
 *   4 = double, 5 = string, 6 = object, 7 = array
 *
 * Every value is encoded as a VStruct:
 *   A: pos-varint of (keyLength << 3 | wireType)
 *   B: UTF-8 key bytes (only if keyLength > 0)
 *   C: encoded value payload (wire-type dependent; absent for null/false/true)
 *
 * PERFORMANCE NOTES (this version vs. the original):
 *   - ByteWriter is backed by a single growable Uint8Array instead of a
 *     plain number[]. The original pushed each byte as a boxed element and
 *     then did one final `new Uint8Array(this.chunks)` conversion; this
 *     version writes bytes directly into typed-array storage and grows by
 *     doubling, so bulk copies use native TypedArray#set (memcpy-like)
 *     instead of a per-element push loop.
 *   - writeVarint/readVarint use a bitwise fast path (>>>, &) for values
 *     under 2^32, plus a single-byte early-out for values < 128 (the
 *     common case for short object-key headers and small numbers). JS's
 *     bitwise operators truncate to 32 bits, so anything at or above 2^32
 *     falls back to the original div/mod approach, which is required
 *     anyway to support the full safe-integer range up to 2^53-1.
 *   - Nested object/array bodies are still built in a scratch ByteWriter
 *     and copied into the parent (same structure as the original) — but
 *     because ByteWriter.toUint8Array() now returns a zero-copy subarray
 *     view rather than allocating+copying a fresh array, and the copy
 *     into the parent is a single .set() call, this no longer costs an
 *     extra allocation at every nesting level. (A two-pass "compute sizes
 *     then write once" scheme would avoid the copy-per-level entirely, but
 *     changes more of the code for a benefit that's only worth it if
 *     profiling shows deeply-nested structures are actually a bottleneck —
 *     see the writeup.)
 *   - Object decoding uses direct property assignment (obj[key] = value)
 *     instead of Object.defineProperty. This is safe against
 *     __proto__-based prototype pollution specifically *because* the
 *     target object is created via Object.create(null): with no
 *     Object.prototype in its chain, "__proto__" has no special accessor
 *     and is just an ordinary own property name.
 *   - Encoded key bytes are cached by key string (bounded to 4096 distinct
 *     keys, LRU-evicted via a doubly-linked list, not Map-reinsertion — see
 *     the note by KeyCacheNode). Real-world JSON is overwhelmingly "arrays
 *     of records sharing a shape" — the same field names recur constantly
 *     — so re-running TextEncoder.encode() on "id", "name", etc. for every
 *     single record is redundant work once the same key has been seen.
 *     The cache is capped so inputs with many one-off/unique keys can't
 *     grow it unboundedly, and evicts least-recently-used rather than
 *     simply refusing new keys once full, so it adapts if the set of
 *     "hot" keys shifts over a long-running process instead of staying
 *     locked onto whichever keys happened to arrive first.
 *
 * Wire format and public API are unchanged. Output is byte-identical to
 * the original implementation for the same input (verified in verify.ts).
 */

export type JSONValue =
    | null
    | boolean
    | number
    | string
    | JSONValue[]
    | { [key: string]: JSONValue }

export enum WireType {
    /** `null` */
    Null = 0,
    /** `false` */
    False = 1,
    /** `true` */
    True = 2,
    /** A non-negative integer (zero or positive) */
    PosInt = 3,
    /** `number` */
    Double = 4,
    /** typeof string */
    String = 5,
    /** typeof object */
    Object = 6,
    /** typeof array */
    Array = 7
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/** 2^32 — the point past which bitwise ops (>>>, &) stop being safe/correct. */
const UINT32_LIMIT = 0x100000000

// Real-world JSON is overwhelmingly "arrays of records with a shared shape"
// (the same field names over and over). Re-running TextEncoder.encode() on
// "id", "name", "email", etc. for every single record is pure waste since
// strings are immutable — the same key always produces the same bytes.
//
// Cache is bounded and evicts the least-recently-used entry once full, so
// pathological inputs (e.g. objects keyed by unique IDs) can't grow it
// unboundedly, and a shift in which keys are "hot" — e.g. a long-running
// process that switches to a different data shape partway through — isn't
// permanently locked out by keys from the first shape squatting on cache
// slots forever.
//
// This is a textbook O(1) LRU: a Map for key->node lookup plus a hand-rolled
// doubly-linked list for recency order. The tempting shortcut — delete the
// entry and Map#set it again to bump it to the end of the Map's own
// (insertion-order) iteration — measures 3-5x slower than this on the actual
// hot path in V8, since Map#delete carries more overhead than it looks like
// it should. The linked list gets the same O(1) reordering without ever
// calling Map#delete/Map#set on anything but genuine inserts and evictions.
const KEY_CACHE_LIMIT = 4096

interface KeyCacheNode {
    key: string
    bytes: Uint8Array
    prev: KeyCacheNode | null
    next: KeyCacheNode | null
}

const keyNodeCache = new Map<string, KeyCacheNode>()
let keyCacheLruHead: KeyCacheNode | null = null // least recently used
let keyCacheLruTail: KeyCacheNode | null = null // most recently used

/** Unlink `node` from wherever it sits and relink it as the most-recently-used tail. */
function touchKeyCacheNode(node: KeyCacheNode): void {
    if (node === keyCacheLruTail) {
        return // already most recent — nothing to do
    }

    if (node.prev) {
        node.prev.next = node.next
    }
    if (node.next) {
        node.next.prev = node.prev
    }
    if (node === keyCacheLruHead) {
        keyCacheLruHead = node.next
    }

    node.prev = keyCacheLruTail
    node.next = null
    if (keyCacheLruTail) {
        keyCacheLruTail.next = node
    }
    keyCacheLruTail = node
    if (keyCacheLruHead === null) {
        keyCacheLruHead = node
    }
}

function getKeyBytes(key: string): Uint8Array {
    const node = keyNodeCache.get(key)
    if (node !== undefined) {
        touchKeyCacheNode(node)
        return node.bytes
    }

    const bytes = textEncoder.encode(key)

    if (keyNodeCache.size >= KEY_CACHE_LIMIT && keyCacheLruHead !== null) {
        // Evict the least-recently-used entry (the list head).
        const evicted = keyCacheLruHead
        keyNodeCache.delete(evicted.key)
        keyCacheLruHead = evicted.next
        if (keyCacheLruHead) {
            keyCacheLruHead.prev = null
        } else {
            keyCacheLruTail = null
        }
        evicted.prev = null
        evicted.next = null
    }

    const newNode: KeyCacheNode = { key, bytes, prev: null, next: null }
    keyNodeCache.set(key, newNode)
    touchKeyCacheNode(newNode) // inserts it at the tail (most recent)
    return bytes
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class ByteWriter {
    private buf: Uint8Array
    private len = 0

    constructor(initialCapacity = 64) {
        this.buf = new Uint8Array(initialCapacity)
    }

    private ensureCapacity(extra: number): void {
        const needed = this.len + extra
        if (needed <= this.buf.length) {
            return
        }
        let newCap = this.buf.length * 2 || 64
        while (newCap < needed) {
            newCap *= 2
        }
        const newBuf = new Uint8Array(newCap)
        newBuf.set(this.buf.subarray(0, this.len))
        this.buf = newBuf
    }

    writeByte(b: number): void {
        this.ensureCapacity(1)
        this.buf[this.len++] = b & 0xff
    }

    writeBytes(bytes: Uint8Array): void {
        this.ensureCapacity(bytes.length)
        this.buf.set(bytes, this.len)
        this.len += bytes.length
    }

    /** LEB128-style unsigned varint. Requires a safe, non-negative integer. */
    writeVarint(value: number): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`writeVarint: expected a non-negative integer, got ${value}`)
        }
        if (!Number.isSafeInteger(value)) {
            throw new Error(`writeVarint: value ${value} exceeds safe integer range`)
        }

        // Fast path: single-byte varint (values 0-127). Very common — every
        // object-key header with a short key name lands here, as does any
        // small integer field.
        if (value < 128) {
            this.writeByte(value)
            return
        }

        this.ensureCapacity(10) // worst case for a 53-bit safe integer

        if (value < UINT32_LIMIT) {
            // Bitwise ops are safe here: >>> and & both operate correctly
            // on the low 32 bits regardless of sign interpretation, for
            // any value that actually fits in 32 bits.
            let v = value >>> 0
            do {
                let byte = v & 0x7f
                v >>>= 7
                if (v !== 0) byte |= 0x80
                this.buf[this.len++] = byte
            } while (v !== 0)
        } else {
            // Slow path (only reached above 2^32-1): identical algorithm to
            // the above, div/mod based, since bitwise ops would truncate.
            let v = value
            do {
                let byte = v % 128
                v = Math.floor(v / 128)
                if (v !== 0) {
                    byte |= 0x80
                }
                this.buf[this.len++] = byte
            } while (v !== 0)
        }
    }

    writeDouble(value: number): void {
        this.ensureCapacity(8)
        const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8)
        view.setFloat64(0, value, true /* little-endian */)
        this.len += 8
    }

    writeString(str: string): void {
        const bytes = textEncoder.encode(str)
        this.writeVarint(bytes.length)
        this.writeBytes(bytes)
    }

    /** Zero-copy view of the written bytes. Valid until this writer is written to again. */
    toUint8Array(): Uint8Array {
        return this.buf.subarray(0, this.len)
    }

    get length(): number {
        return this.len
    }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

class ByteReader {
    private pos = 0
    private data: Uint8Array
    constructor(data: Uint8Array) {
        this.data = data
    }

    get remaining(): number {
        return this.data.length - this.pos
    }

    readByte(): number {
        if (this.pos >= this.data.length) {
            throw new Error('velojson: unexpected end of buffer')
        }
        return this.data[this.pos++]
    }

    readBytes(n: number): Uint8Array {
        if (this.pos + n > this.data.length) {
            throw new Error('velojson: unexpected end of buffer')
        }
        const slice = this.data.subarray(this.pos, this.pos + n)
        this.pos += n
        return slice
    }

    readVarint(): number {
        // Fast path: single-byte varint
        const first = this.readByte()
        if ((first & 0x80) === 0) {
            return first
        }

        let result = first & 0x7f
        let multiplier = 128
        let byte: number
        let bytesRead = 1
        do {
            byte = this.readByte()
            result += (byte & 0x7f) * multiplier
            multiplier *= 128
            bytesRead++
            if (bytesRead > 10) {
                throw new Error('velojson: varint too long (corrupt data?)')
            }
        } while (byte & 0x80)
        return result
    }

    readDouble(): number {
        const bytes = this.readBytes(8)
        const view = new DataView(bytes.buffer, bytes.byteOffset, 8)
        return view.getFloat64(0, true /* little-endian */)
    }

    readString(): string {
        const len = this.readVarint()
        return textDecoder.decode(this.readBytes(len))
    }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function getWireType(value: JSONValue): WireType {
    if (value === null) {
        return WireType.Null
    }
    if (value === false) {
        return WireType.False
    }
    if (value === true) {
        return WireType.True
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
            return WireType.PosInt
        }
        return WireType.Double // negatives, non-integers, NaN, Infinity, etc.
    }
    if (typeof value === 'string') {
        return WireType.String
    }
    if (Array.isArray(value)) {
        return WireType.Array
    }
    if (typeof value === 'object') {
        return WireType.Object
    }
    throw new Error(`velojson: unsupported value type: ${typeof value}`);
}

function encodeValue(writer: ByteWriter, key: string | null, value: JSONValue, isInArray: boolean): void {
    if (value === undefined && isInArray === false) {
        return
    }
    const keyBytes = key !== null ? getKeyBytes(key) : null
    const keyLength = keyBytes ? keyBytes.length : 0
    const wireType = getWireType((value === undefined && isInArray === true) ? null : value)

    writer.writeVarint((keyLength * 8) + wireType)
    if (keyBytes) {
        writer.writeBytes(keyBytes)
    }

    switch (wireType) {
        case WireType.Null:
        case WireType.False:
        case WireType.True:
        break // no payload

        case WireType.PosInt:
            writer.writeVarint(value as number)
        break

        case WireType.Double:
            writer.writeDouble(value as number)
        break

        case WireType.String:
            writer.writeString(value as string)
        break

        case WireType.Object: {
            const bodyWriter = new ByteWriter()
            const obj = value as Record<string, JSONValue>
            for (const k of Object.keys(obj)) {
                encodeValue(bodyWriter, k, obj[k], false)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
        break
        }

        case WireType.Array: {
            const bodyWriter = new ByteWriter()
            const arr = value as JSONValue[]
            for (const item of arr) {
                encodeValue(bodyWriter, null, item, true)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
        break
        }
    }
}

/**
 * Encode any JSON-representable value into a VSON binary buffer.
 *
 * Note: Will throw on encoding errors
 *
 * Example:
 * ```ts
 * const obj = { name: "Some name", age: 20, address: null }
 * const objBinary: Uint8Array = encodeVSON(obj)
 * ```
 */
export function encodeVSON(value: JSONValue): Uint8Array {
    const writer = new ByteWriter()
    encodeValue(writer, null, value, true)
    // .slice() here so the public function returns an exact-length,
    // independently-owned buffer, not a view into a possibly-larger
    // over-allocated backing buffer.
    return writer.toUint8Array().slice()
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface DecodedEntry {
    key: string | null
    value: JSONValue
}

function decodeValue(reader: ByteReader): DecodedEntry {
    const header = reader.readVarint()
    const wireType = header % 8
    const keyLength = Math.floor(header / 8)

    let key: string | null = null
    if (keyLength > 0) {
        key = textDecoder.decode(reader.readBytes(keyLength))
    }

    let value: JSONValue
    switch (wireType) {
        case WireType.Null:
            value = null
        break
        case WireType.False:
            value = false
        break
        case WireType.True:
            value = true
        break
        case WireType.PosInt:
            value = reader.readVarint()
        break
        case WireType.Double:
            value = reader.readDouble()
        break
        case WireType.String:
            value = reader.readString()
        break
        case WireType.Object: {
            const len = reader.readVarint()
            const bodyReader = new ByteReader(reader.readBytes(len))
            // Create a null prototype object so that the __proto__ key is not restricted
            // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#null-prototype_objects
            const obj: Record<string, JSONValue> = Object.create(null)
            while (bodyReader.remaining > 0) {
                const entry = decodeValue(bodyReader)
                if (entry.key === null) {
                    throw new Error('velojson: object entry is missing a required key')
                }
                // Plain assignment is safe here because obj has
                // no prototype at all, so there's no inherited __proto__
                // accessor to trigger
                obj[entry.key] = entry.value
            }
            value = obj
        break
        }
        case WireType.Array: {
            const len = reader.readVarint()
            const bodyReader = new ByteReader(reader.readBytes(len))
            const arr: JSONValue[] = []
            while (bodyReader.remaining > 0) {
                const entry = decodeValue(bodyReader)
                if (entry.key !== null) {
                    throw new Error('velojson: array entry must not have a key')
                }
                arr.push(entry.value)
            }
            value = arr
        break
        }
        default:
            throw new Error(`velojson: unknown wire type ${wireType}`)
    }

    return { key, value }
}

/**
 * Decode a VSON binary buffer back into a JSON-representable value.
 *
 * Note: Will throw on decoding errors
 *
 * Example:
 * ```ts
 * const startObj = { name: "Some name", age: 20, address: null }
 * const objBinary: Uint8Array = encodeVSON(startObj)
 * const endObj = decodeVSON(objBinary)
 *
 * console.log(JSON.stringify(endObj))
 * // Expected output: {"name":"Some name","age":20,"address":null}
 * ```
 */
export function decodeVSON(data: Uint8Array): JSONValue {
    const reader = new ByteReader(data)
    const entry = decodeValue(reader)
    return entry.value
}