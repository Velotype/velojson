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
 */

/**
 * Type representing encodable values (aka: plain JSON objects)
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

export enum EncodingFormat {
    Base = 0,
    StringTable = 1
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
    /** Cached DataView over the current backing buffer */
    private bufView: DataView
    private len = 0

    constructor(initialCapacity = 64) {
        this.buf = new Uint8Array(initialCapacity)
        this.bufView = new DataView(this.buf.buffer)
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
        this.bufView = new DataView(this.buf.buffer) // buffer identity changed — must refresh
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
                if (v !== 0) {
                    byte |= 0x80
                }
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
        this.bufView.setFloat64(this.len, value, true)
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

    /** Reuse this writer for a new value: keeps the backing buffer (and its
     *  already-sized capacity) but discards previously written content. */
    reset(): void {
        this.len = 0
    }
}

const WRITER_POOL_LIMIT = 1024
const writerPool: ByteWriter[] = []

function acquireWriter(): ByteWriter {
    const writer = writerPool.pop()
    if (writer !== undefined) {
        writer.reset()
        return writer
    }
    return new ByteWriter()
}

function releaseWriter(writer: ByteWriter): void {
    if (writerPool.length < WRITER_POOL_LIMIT) {
        writerPool.push(writer)
    }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

class ByteReader {
    private pos = 0
    private data: Uint8Array
    private view: DataView
    /** Read boundary for the current nested section (top-level: data.length) */
    private limit: number
    private keyArray: string[] = []
    private encodingFormat: EncodingFormat = EncodingFormat.Base

    constructor(data: Uint8Array) {
        this.data = data
        this.view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        this.limit = data.length
    }

    private readByte(): number {
        if (this.pos < this.limit) {
            return this.data[this.pos++]
        } else {
            throw new Error('velojson: unexpected end of buffer')
        }
    }

    private readBytes(n: number): Uint8Array {
        if (this.pos + n <= this.limit) {
            const slice = this.data.subarray(this.pos, this.pos + n)
            this.pos += n
            return slice
        } else {
            throw new Error('velojson: unexpected end of buffer')
        }
    }

    private readVarintInPlace(): number {
        const pos = this.pos
        const limit = this.limit
        const num = this.readVarint()
        this.pos = pos
        this.limit = limit
        return num
    }

    private readVarint(): number {
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

    private readDouble(): number {
        if (this.pos + 8 > this.limit) {
            throw new Error('velojson: unexpected end of buffer')
        }
        const value = this.view.getFloat64(this.pos, true)
        this.pos += 8
        return value
    }

    private readString(): string {
        const len = this.readVarint()
        return textDecoder.decode(this.readBytes(len))
    }

    private decodeObjectValue(): Record<string, JSONValue> {
        const len = this.readVarint()
        // enterSection
        if (this.pos + len > this.limit) {
            throw new Error('velojson: unexpected end of buffer')
        }
        const previousLimit = this.limit
        this.limit = this.pos + len

        // Create a null prototype object so that the __proto__ key is not restricted
        // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#null-prototype_objects
        const obj: Record<string, JSONValue> = Object.create(null)
        while (this.limit > this.pos) {
            this.decodeValue()
            if (this.decodeValueTempKey === null) {
                throw new Error('velojson: object entry is missing a required key')
            }
            // Plain assignment is safe here because obj has no prototype at
            // all, so there's no inherited __proto__ accessor to trigger
            obj[this.decodeValueTempKey] = this.decodeValueTempValue
        }
        // exitSection
        this.pos = this.limit
        this.limit = previousLimit
        return obj
    }

    private decodeArrayValue(): JSONValue[] {
        const lengthAndFlag = this.readVarint()
        let len: number
        let isHomogeneous: boolean
        if (lengthAndFlag < UINT32_LIMIT) {
            isHomogeneous = (lengthAndFlag & 1) === 1
            len = lengthAndFlag >>> 1
        } else {
            isHomogeneous = (lengthAndFlag % 2) === 1
            len = Math.floor(lengthAndFlag / 2)
        }

        // enterSection
        if (this.pos + len > this.limit) {
            throw new Error('velojson: unexpected end of buffer')
        }
        const previousLimit = this.limit
        this.limit = this.pos + len

        let arr: JSONValue[]

        if (isHomogeneous) {
            const sharedType = this.readByte()
            if (sharedType === WireType.Null || sharedType === WireType.False || sharedType === WireType.True) {
                throw new Error('velojson: homogeneous array cannot use a zero-payload wire type')
            }
            switch (sharedType) {
                case WireType.PosInt:
                    arr = []
                    while (this.limit > this.pos) {
                        arr.push(this.readVarint())
                    }
                break
                case WireType.Double:
                    if (this.pos + 8 > this.limit) {
                        throw new Error('velojson: unexpected end of buffer')
                    }
                    if ((this.limit - this.pos) % 8 != 0) {
                        throw new Error('velojson: unexpected end of buffer')
                    }
                    arr = []
                    while (this.limit > this.pos) {
                        arr.push(this.view.getFloat64(this.pos, true))
                        this.pos += 8
                    }
                break
                case WireType.String:
                    arr = []
                    while (this.limit > this.pos) {
                        const len = this.readVarint()
                        arr.push(textDecoder.decode(this.readBytes(len)))
                    }
                break
                case WireType.Object:
                    arr = []
                    while (this.limit > this.pos) {
                        arr.push(this.decodeObjectValue())
                    }
                break
                case WireType.Array:
                    arr = []
                    while (this.limit > this.pos) {
                        arr.push(this.decodeArrayValue())
                    }
                break
                default:
                    throw new Error(`velojson: invalid wire type ${sharedType}`)
            }
        } else {
            arr = []
            while (this.limit > this.pos) {
                this.decodeValue()
                if (this.decodeValueTempKey !== null) {
                    throw new Error('velojson: array entry must not have a key')
                }
                arr.push(this.decodeValueTempValue)
            }
        }

        // exitSection
        this.pos = this.limit
        this.limit = previousLimit
        return arr
    }

    private decodeStringTableArrayValue(): string[] {
        const len = this.readVarint()

        // enterSection
        if (this.pos + len > this.limit) {
            console.log(this.pos, len, this.limit)
            throw new Error('velojson: unexpected end of buffer')
        }
        const previousLimit = this.limit
        this.limit = this.pos + len

        const arr: string[] = []
        /** The String Table is 1-indexed so inject empty string as a zero-index placeholder */
        arr.push("")
        while (this.limit > this.pos) {
            const len = this.readVarint()
            arr.push(textDecoder.decode(this.readBytes(len)))
        }

        // exitSection
        this.pos = this.limit
        this.limit = previousLimit
        return arr
    }

    decodeRootValue(): JSONValue {
        const header = this.readVarint()
        let wireType: number
        let encodingFormat: number
        if (header < UINT32_LIMIT) {
            wireType = header & 7
            encodingFormat = header >>> 3
        } else {
            wireType = header % 8
            encodingFormat = Math.floor(header / 8)
        }
        this.encodingFormat = encodingFormat

        if (encodingFormat === EncodingFormat.Base) {
            switch (wireType) {
                case WireType.Null:
                    return null
                case WireType.False:
                    return false
                case WireType.True:
                    return true
                case WireType.PosInt:
                    return this.readVarint()
                case WireType.Double:
                    return this.readDouble()
                case WireType.String:
                    return this.readString()
                case WireType.Object:
                    return this.decodeObjectValue()
                case WireType.Array:
                    return this.decodeArrayValue()
                default:
                    throw new Error(`velojson: unknown wire type ${wireType}`)
            }
        } else if (encodingFormat == EncodingFormat.StringTable) {
            if (wireType !== WireType.Object && wireType !== WireType.Array) {
                throw new Error('velojson: StringTable encoding format only valid for Object and Array root values')
            }
            const pos = this.pos
            const totalValueLen = this.readVarint()
            if (wireType === WireType.Object) {
                this.pos += totalValueLen
                this.keyArray = this.decodeStringTableArrayValue()
                this.pos = pos
                return this.decodeObjectValue()
            } else {
                this.pos += Math.floor(totalValueLen / 2)
                this.keyArray = this.decodeStringTableArrayValue()
                this.pos = pos
                return this.decodeArrayValue()
            }
        } else {
            throw new Error('velojson: unrecognized encoding format')
        }
    }

    /** Used to avoid additional object allocation when returning two vars from decodeValue */
    private decodeValueTempKey: string | null = null
    /** Used to avoid additional object allocation when returning two vars from decodeValue */
    private decodeValueTempValue: JSONValue = null
    private decodeValue() {
        const header = this.readVarint()
        let wireType: number
        let keyData: number
        if (header < UINT32_LIMIT) {
            wireType = header & 7
            keyData = header >>> 3
        } else {
            wireType = header % 8
            keyData = Math.floor(header / 8)
        }

        let key: string | null = null
        if (keyData > 0) {
            if (this.encodingFormat === EncodingFormat.Base) {
                key = textDecoder.decode(this.readBytes(keyData))
            } else if (this.encodingFormat === EncodingFormat.StringTable) {
                if (keyData <= this.keyArray.length) {
                    key = this.keyArray[keyData]
                } else {
                    throw new Error('velojson: key index out of bounds')
                }
            } else {
                throw new Error('velojson: encoding format not recognized')
            }
        }

        switch (wireType) {
            case WireType.Null:
                this.decodeValueTempValue = null
            break
            case WireType.False:
                this.decodeValueTempValue = false
            break
            case WireType.True:
                this.decodeValueTempValue = true
            break
            case WireType.PosInt:
                this.decodeValueTempValue = this.readVarint()
            break
            case WireType.Double:
                this.decodeValueTempValue = this.readDouble()
            break
            case WireType.String:
                this.decodeValueTempValue = this.readString()
            break
            case WireType.Object:
                this.decodeValueTempValue = this.decodeObjectValue()
            break
            case WireType.Array:
                this.decodeValueTempValue = this.decodeArrayValue()
            break
            default:
                throw new Error(`velojson: unknown wire type ${wireType}`)
        }
        this.decodeValueTempKey = key
    }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function getWireType(value: JSONValue): WireType {
    const typeof_value = typeof value
    if (typeof_value === 'number') {
        if (Number.isInteger(value) && value as number >= 0 && Number.isSafeInteger(value)) {
            return WireType.PosInt
        }
        return WireType.Double // negatives, non-integers, NaN, Infinity, etc.
    }
    if (value === null) {
        return WireType.Null
    }
    if (value === false) {
        return WireType.False
    }
    if (value === true) {
        return WireType.True
    }
    if (typeof_value === 'string') {
        return WireType.String
    }
    if (Array.isArray(value)) {
        return WireType.Array
    }
    if (typeof_value === 'object') {
        return WireType.Object
    }
    throw new Error(`velojson: unsupported value type: ${typeof value}`)
}

function writeNumericArrayFast(writer: ByteWriter, arr: JSONValue[]): void {
    for (let i = 0; i < arr.length; i++) {
        const value = arr[i] as number
        if (Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
            writer.writeByte(WireType.PosInt) // keyLength=0, so header === wireType exactly
            writer.writeVarint(value)
        } else {
            writer.writeByte(WireType.Double)
            writer.writeDouble(value)
        }
    }
}

/** Writes just the payload for `value` of the given `wireType` — no
 *  header, no key. Shared by the generic per-value path (which writes the
 *  header first, then calls this) and the homogeneous-array fast path
 *  (which writes the shared wireType once for the whole array instead). */
function encodeValuePayload(writer: ByteWriter, value: JSONValue, wireType: WireType): void {
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
            const bodyWriter = acquireWriter()
            const obj = value as Record<string, JSONValue>
            for (const k of Object.keys(obj)) {
                encodeValue(bodyWriter, k, obj[k], false)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
            releaseWriter(bodyWriter)
        break
        }

        case WireType.Array:
            encodeArrayValue(writer, value as JSONValue[])
        break
    }
}

const HOMOGENEOUS_DETECTION_MIN_LENGTH = 64
/*
function isAllNumbers(arr: JSONValue[]): boolean {
    for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] !== 'number') {
            return false
        }
    }
    return true
}*/

function encodeArrayValue(writer: ByteWriter, arr: JSONValue[]): void {
    const bodyWriter = acquireWriter()

    let isAllNumbers = false
    let homogeneousType: WireType | null = null
    if (arr.length >= HOMOGENEOUS_DETECTION_MIN_LENGTH) {
        let firstType: WireType | null = null
        for (let i = 0; i < arr.length; i++) {
            const item = arr[i]
            const item_wire_type = getWireType(item === undefined ? null : item)
            if (item_wire_type === WireType.Null || item_wire_type === WireType.False || item_wire_type === WireType.True) {
                homogeneousType = null
                break
            }
            if (firstType === null) {
                firstType = item_wire_type
                homogeneousType = item_wire_type
                if (item_wire_type === WireType.PosInt || item_wire_type === WireType.Double) {
                    isAllNumbers = true
                }
            } else if (item_wire_type !== firstType) {
                homogeneousType = null
                if (!isAllNumbers) {
                    break
                } else {
                    if (item_wire_type !== WireType.PosInt && item_wire_type !== WireType.Double) {
                        isAllNumbers = false
                        break
                    }
                }
            }
        }
    }

    if (homogeneousType !== null) {
        bodyWriter.writeByte(homogeneousType)
        for (let i = 0; i < arr.length; i++) {
            encodeValuePayload(bodyWriter, arr[i], homogeneousType)
        }
    } else if (isAllNumbers) {
        writeNumericArrayFast(bodyWriter, arr)
    } else {
        for (const item of arr) {
            encodeValue(bodyWriter, null, item, true)
        }
    }

    const body = bodyWriter.toUint8Array()
    writer.writeVarint((body.length * 2) + (homogeneousType !== null ? 1 : 0))
    writer.writeBytes(body)
    releaseWriter(bodyWriter)
}

function encodeValue(writer: ByteWriter, key: string | null, value: JSONValue, isInArray: boolean): void {
    if (value === undefined && isInArray === false) {
        return
    }
    const wireType = getWireType((value === undefined && isInArray === true) ? null : value)
    if (key === null) {
        writer.writeVarint(wireType)
     } else if (writerEncodingFormat === EncodingFormat.Base) {
        const keyBytes = getKeyBytes(key)
        const keyLength = keyBytes.length
        writer.writeVarint((keyLength * 8) + wireType)
        writer.writeBytes(keyBytes)
    } else {
        const keyIndex = writerStringTableMap.get(key)
        if (keyIndex !== undefined) {
            writer.writeVarint((keyIndex * 8) + wireType)
        } else {
            writerStringTableArray.push(key)
            writerStringTableMap.set(key, writerStringTableArray.length)
            writer.writeVarint((writerStringTableArray.length * 8) + wireType)
        }
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
            const bodyWriter = acquireWriter()
            const obj = value as Record<string, JSONValue>
            for (const k of Object.keys(obj)) {
                encodeValue(bodyWriter, k, obj[k], false)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
            releaseWriter(bodyWriter)
        break
        }

        case WireType.Array:
            encodeArrayValue(writer, value as JSONValue[])
        break
    }
}

function encodeStringTableValue(writer: ByteWriter, arr: string[]): void {
    const bodyWriter = acquireWriter()

    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item === undefined || item === null) {
            throw new Error('velojson: string table cannot have undefined or null values')
        }
        encodeValuePayload(bodyWriter, item, WireType.String)
    }

    const body = bodyWriter.toUint8Array()
    writer.writeVarint(body.length)
    writer.writeBytes(body)
    releaseWriter(bodyWriter)
}

let writerEncodingFormat: EncodingFormat = EncodingFormat.Base
let writerStringTableMap: Map<string, number> = new Map<string, number>()
let writerStringTableArray: string[] = []

/**
 * Encode any JSON-representable value into a VSON binary buffer.
 *
 * Note: Will throw on encoding errors
 *
 * @param [EncodingFormat] encodingFormat - defaults to StringTable if the value is an object or array
 *
 * Example:
 * ```ts
 * const obj = { name: "Some name", age: 20, address: null }
 * const objBinary: Uint8Array = encodeVSON(obj)
 * ```
 */
// deno-lint-ignore no-explicit-any
function encodeVSON(value: any, encodingFormat?: EncodingFormat): Uint8Array {
    if (value === undefined) {
        return new Uint8Array()
    }

    // Set writerEncodingFormat
    if (encodingFormat === undefined) {
        if (value !== null && (typeof value === "object" || Array.isArray(value))) {
            writerEncodingFormat = EncodingFormat.StringTable
        } else {
            writerEncodingFormat = EncodingFormat.Base
        }
    } else {
        writerEncodingFormat = encodingFormat
    }

    const writer = acquireWriter()
    if (writerEncodingFormat === EncodingFormat.Base) {
        encodeValue(writer, null, value, false)
    } else if (writerEncodingFormat === EncodingFormat.StringTable) {
        const wireType = getWireType(value)
        writer.writeVarint((writerEncodingFormat * 8) + wireType)
        writerStringTableMap = new Map<string, number>()
        writerStringTableArray = []
        switch (wireType) {
            case WireType.Object: {
                const bodyWriter = acquireWriter()
                const obj = value as Record<string, JSONValue>
                for (const k of Object.keys(obj)) {
                    encodeValue(bodyWriter, k, obj[k], false)
                }
                const body = bodyWriter.toUint8Array()
                writer.writeVarint(body.length)
                writer.writeBytes(body)
                releaseWriter(bodyWriter)
            break
            }
            case WireType.Array:
                encodeArrayValue(writer, value as JSONValue[])
            break
            default:
                throw new Error('velojson: String table encoding format only supported for root Object or Array types')
        }
        encodeStringTableValue(writer, writerStringTableArray)
    } else {
        throw new Error('velojson: encoding format not recognized')
    }
    // .slice() here so the public function returns an exact-length,
    // independently-owned buffer, not a view into a possibly-larger
    // over-allocated backing buffer.
    const result = writer.toUint8Array().slice()
    releaseWriter(writer)
    return result
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

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
// deno-lint-ignore no-explicit-any
function decodeVSON(data: Uint8Array): any {
    if (data.length == 0) {
        return undefined
    }
    const reader = new ByteReader(data)
    return reader.decodeRootValue()
}

export const VSON = {
    encode: encodeVSON,
    decode: decodeVSON
}
