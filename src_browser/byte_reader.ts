import { boom, EncodingFormat_KeyTable, type JSONValue, splitPacked, textDecoder, WireType } from "./common.ts"

export class ByteReader {
    /** pos */
    private p = 0
    /** data */
    private d: Uint8Array
    /** view */
    private v: DataView
    /** limit - Read boundary for the current nested section (top-level: data.length) */
    private m: number
    /** keyArray */
    private k: string[] = []

    constructor(data: Uint8Array) {
        this.d = data
        this.v = new DataView(data.buffer, data.byteOffset, data.byteLength)
        this.m = data.length
    }

    #readByte(): number {
        if (this.p < this.m) return this.d[this.p++]
        boom() // 'unexpected eob'
    }

    #readBytes(n: number): Uint8Array {
        if (this.p + n > this.m) boom() // 'unexpected eob'
        const slice = this.d.subarray(this.p, this.p + n)
        this.p += n
        return slice
    }

    #readVarint(): number {
        // Fast path: single-byte varint
        const first = this.#readByte()
        if ((first & 0x80) === 0) {
            return first
        }

        let result = first & 0x7f
        let multiplier = 128
        let byte: number
        let bytesRead = 1
        do {
            byte = this.#readByte()
            result += (byte & 0x7f) * multiplier
            multiplier *= 128
            if (++bytesRead > 10) boom() // 'varint invalid'
        } while (byte & 0x80)
        return result
    }

    #readDouble(): number {
        if (this.p + 8 > this.m) boom() // 'unexpected eob'
        const value = this.v.getFloat64(this.p, true)
        this.p += 8
        return value
    }

    #readString(): string {
        const len = this.#readVarint()
        return textDecoder.decode(this.#readBytes(len))
    }

    /** Enter a length-prefixed nested section, narrowing `m` (limit) to `p + len`.
     *  Returns the previous limit; pass it to `ex` when done reading the section. */
    #enterSection(len: number): number {
        if (this.p + len > this.m) {
            boom() // 'unexpected eob'
        }
        const previousLimit = this.m
        this.m = this.p + len
        return previousLimit
    }

    #exitSection(previousLimit: number): void {
        this.p = this.m
        this.m = previousLimit
    }

    #decodeObjectValue(): Record<string, JSONValue> {
        const previousLimit = this.#enterSection(this.#readVarint())

        // Create a null prototype object so that the __proto__ key is not restricted
        // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#null-prototype_objects
        const obj: Record<string, JSONValue> = Object.create(null)
        while (this.m > this.p) {
            this.#decodeObjectFieldValue(obj)
        }
        this.#exitSection(previousLimit)
        return obj
    }

    #decodeArrayValue(): JSONValue[] {
        const [flag, len] = splitPacked(this.#readVarint(), 1)
        const isHomogeneous = flag === 1

        const previousLimit = this.#enterSection(len)
        const arr: JSONValue[] = []

        if (isHomogeneous) {
            const sharedType = this.#readByte()
            if (sharedType === WireType.N || sharedType === WireType.F || sharedType === WireType.T) {
                boom() // 'invalid array'
            }
            switch (sharedType) {
                case WireType.P:
                    while (this.m > this.p) {
                        arr.push(this.#readVarint())
                    }
                break
                case WireType.D:
                    if (this.p + 8 > this.m || (this.m - this.p) % 8 !== 0) {
                        boom() // 'unexpected eob'
                    }
                    while (this.m > this.p) {
                        arr.push(this.v.getFloat64(this.p, true))
                        this.p += 8
                    }
                break
                case WireType.S:
                    while (this.m > this.p) {
                        const len = this.#readVarint()
                        arr.push(textDecoder.decode(this.#readBytes(len)))
                    }
                break
                case WireType.O:
                    while (this.m > this.p) {
                        arr.push(this.#decodeObjectValue())
                    }
                break
                case WireType.A:
                    while (this.m > this.p) {
                        arr.push(this.#decodeArrayValue())
                    }
                break
                default:
                    boom() // 'invalid type'
            }
        } else {
            while (this.m > this.p) {
                arr.push(this.#decodeArrayEntryValue())
            }
        }

        this.#exitSection(previousLimit)
        return arr
    }

    #decodeKeyTableArrayValue(): string[] {
        const previousLimit = this.#enterSection(this.#readVarint())

        /** The String Table is 1-indexed so inject empty string as a zero-index placeholder */
        const arr: string[] = [""]
        while (this.m > this.p) {
            const len = this.#readVarint()
            arr.push(textDecoder.decode(this.#readBytes(len)))
        }
        this.#exitSection(previousLimit)
        return arr
    }

    /** decodeRootValue */
    dR(): JSONValue {
        const [wireType, encodingFormat] = splitPacked(this.#readVarint(), 3)
        if (encodingFormat !== EncodingFormat_KeyTable) boom() // 'invalid format'
        if (wireType !== WireType.O && wireType !== WireType.A) {
            boom() // 'value invalid'
        }

        const pos = this.p
        const totalValueLen = this.#readVarint()
        if (wireType === WireType.O) {
            this.p += totalValueLen
            this.k = this.#decodeKeyTableArrayValue()
            this.p = pos
            return this.#decodeObjectValue()
        }
        this.p += Math.floor(totalValueLen / 2)
        this.k = this.#decodeKeyTableArrayValue()
        this.p = pos
        return this.#decodeArrayValue()
    }

    #decodeObjectFieldValue(obj: Record<string, JSONValue>): void {
        const [wireType, keyData] = splitPacked(this.#readVarint(), 3)

        let key: string
        if (keyData === 0) {
            key = boom() // 'missing a required key'
        }
        key = keyData <= this.k.length ? this.k[keyData] : boom() // 'out of bounds'

        // Plain assignment is safe here because obj has no prototype at
        // all, so there's no inherited __proto__ accessor to trigger
        switch (wireType) {
            case WireType.N: obj[key] = null; break
            case WireType.F: obj[key] = false; break
            case WireType.T: obj[key] = true; break
            case WireType.P: obj[key] = this.#readVarint(); break
            case WireType.D: obj[key] = this.#readDouble(); break
            case WireType.S: obj[key] = this.#readString(); break
            case WireType.O: obj[key] = this.#decodeObjectValue(); break
            case WireType.A: obj[key] = this.#decodeArrayValue(); break
            default: boom() // 'unknown type'
        }
    }

    #decodeArrayEntryValue(): JSONValue {
        const [wireType, keyData] = splitPacked(this.#readVarint(), 3)
        if (keyData > 0) boom() // 'array invalid'

        switch (wireType) {
            case WireType.N: return null
            case WireType.F: return false
            case WireType.T: return true
            case WireType.P: return this.#readVarint()
            case WireType.D: return this.#readDouble()
            case WireType.S: return this.#readString()
            case WireType.O: return this.#decodeObjectValue()
            case WireType.A: return this.#decodeArrayValue()
            default: return boom() // 'unknown type'
        }
    }
}