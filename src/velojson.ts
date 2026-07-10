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
 * NOTE ON SPEC AMBIGUITIES RESOLVED HERE (see accompanying explanation):
 *   - The 3-bit wire-type suffix in "A" is the type's own numeric value
 *     (0..7 in binary), not the literal "100" shown for every type past
 *     null/false/true in the source README (that repetition was a copy/paste
 *     artifact — only type 4 can correctly be 100).
 *   - Varints are LEB128-style: 7 data bits + continuation bit, base-256,
 *     least-significant group first.
 *   - Doubles are IEEE-754 8-byte, little-endian.
 *   - Object/array LENGTH is the byte length of the encoded body (mirrors
 *     how string LENGTH is a byte length), enabling skip-without-parsing.
 */

export type JSONValue =
    | null
    | boolean
    | number
    | string
    | JSONValue[]
    | { [key: string]: JSONValue }

export enum WireType {
    Null = 0,
    False = 1,
    True = 2,
    PosInt = 3,
    Double = 4,
    String = 5,
    Object = 6,
    Array = 7,
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

class ByteWriter {
    private chunks: number[] = [];

    writeByte(b: number): void {
        this.chunks.push(b & 0xff);
    }

    writeBytes(bytes: Uint8Array): void {
        for (let i = 0; i < bytes.length; i++) this.chunks.push(bytes[i]);
    }

    /** LEB128-style unsigned varint. Requires a safe, non-negative integer. */
    writeVarint(value: number): void {
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`writeVarint: expected a non-negative integer, got ${value}`)
        }
        if (!Number.isSafeInteger(value)) {
            throw new Error(`writeVarint: value ${value} exceeds safe integer range`)
        }
        let v = value
        do {
            let byte = v % 128
            v = Math.floor(v / 128)
            if (v !== 0) {
                byte |= 0x80
            }
            this.writeByte(byte)
        } while (v !== 0)
    }

    writeDouble(value: number): void {
        const buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, value, true /* little-endian */);
        this.writeBytes(new Uint8Array(buf));
    }

    writeString(str: string): void {
        const bytes = textEncoder.encode(str);
        this.writeVarint(bytes.length);
        this.writeBytes(bytes);
    }

    toUint8Array(): Uint8Array {
        return new Uint8Array(this.chunks);
    }

    get length(): number {
        return this.chunks.length;
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
        let result = 0
        let multiplier = 1
        let byte: number
        let bytesRead = 0
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
    const keyBytes = key !== null ? textEncoder.encode(key) : null
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

/** Encode any JSON-representable value into a VSON binary buffer. */
export function encodeVSON(value: JSONValue): Uint8Array {
    const writer = new ByteWriter()
    encodeValue(writer, null, value, true)
    return writer.toUint8Array()
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
                Object.defineProperty(obj, entry.key, {
                    value: entry.value,
                    writable: true,
                    enumerable: true,
                    configurable: true
                })
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

/** Decode a VSON binary buffer back into a JSON-representable value. */
export function decodeVSON(data: Uint8Array): JSONValue {
    const reader = new ByteReader(data)
    const entry = decodeValue(reader)
    return entry.value
}
