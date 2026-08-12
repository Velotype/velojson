import { type ByteWriter, acquireWriter, releaseWriter } from "./byte_writer.ts"
import { type JSONValue, textDecoder, EncodingFormat, UINT32_LIMIT, WireType } from "./common.ts"

export class VBINByteReader {
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

    readByte(): number {
        if (this.pos < this.limit) {
            return this.data[this.pos++]
        } else {
            throw new Error('velojson: unexpected end of buffer')
        }
    }

    readBytes(n: number): Uint8Array {
        if (this.pos + n <= this.limit) {
            const slice = this.data.subarray(this.pos, this.pos + n)
            this.pos += n
            return slice
        } else {
            throw new Error('velojson: unexpected end of buffer')
        }
    }

    readVarintInPlace(): number {
        const oldPos = this.pos
        const result = this.readVarint()
        this.pos = oldPos
        return result
    }

    readVarintIfBoolean(key_id: number): boolean | undefined {
        const oldPos = this.pos

        const first = this.readByte()
        let result
        if ((first & 0x80) === 0) {
            result = first
        } else {
            result = first & 0x7f
            let multiplier = 128
            let byte: number
            let bytesRead = 1
            do {
                byte = this.readByte()
                result += (byte & 0x7f) * multiplier
                multiplier *= 128
                bytesRead++
                if (bytesRead > 10) {
                    throw new Error('velojson: varint too long (corrupt data)')
                }
            } while (byte & 0x80)
        }

        let wireType: number
        let keyId: number
        if (result < UINT32_LIMIT) {
            wireType = result & 7
            keyId = result >>> 3
        } else {
            wireType = result % 8
            keyId = Math.floor(result / 8)
        }
        if (keyId !== key_id) {
            this.pos = oldPos
            return undefined
        }
        if (wireType !== WireType.True && wireType !== WireType.False) {
            this.pos = oldPos
            return undefined
        }
        if (wireType === WireType.True) {
            return true
        }
        return false
    }
    readVarintIfMatch(key_id: number, wire_type: WireType): boolean {
        const oldPos = this.pos

        const first = this.readByte()
        let result
        if ((first & 0x80) === 0) {
            result = first
        } else {
            result = first & 0x7f
            let multiplier = 128
            let byte: number
            let bytesRead = 1
            do {
                byte = this.readByte()
                result += (byte & 0x7f) * multiplier
                multiplier *= 128
                bytesRead++
                if (bytesRead > 10) {
                    throw new Error('velojson: varint too long (corrupt data)')
                }
            } while (byte & 0x80)
        }

        let wireType: number
        let keyId: number
        if (result < UINT32_LIMIT) {
            wireType = result & 7
            keyId = result >>> 3
        } else {
            wireType = result % 8
            keyId = Math.floor(result / 8)
        }
        if (keyId !== key_id) {
            this.pos = oldPos
            return false
        }
        if (wireType !== wire_type) {
            this.pos = oldPos
            return false
        }
        return true
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
                throw new Error('velojson: varint too long (corrupt data)')
            }
        } while (byte & 0x80)
        return result
    }

    readDouble(): number {
        if (this.pos + 8 > this.limit) {
            throw new Error('velojson: unexpected end of buffer')
        }
        const value = this.view.getFloat64(this.pos, true)
        this.pos += 8
        return value
    }

    readString(): string {
        const len = this.readVarint()
        return textDecoder.decode(this.readBytes(len))
    }

    decodeObjectValue(): Record<string, JSONValue> {
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

    decodeArrayValue(): JSONValue[] {
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
        } else if (encodingFormat == EncodingFormat.KeyTable) {
            if (wireType !== WireType.Object && wireType !== WireType.Array) {
                throw new Error('velojson: StringTable encoding format only valid for Object and Array root values')
            }
            const pos = this.pos
            const totalValueLen = this.readVarint()
            if (wireType === WireType.Object) {
                this.pos += totalValueLen
//                this.keyArray = this.decodeStringTableArrayValue()
                this.pos = pos
                return this.decodeObjectValue()
            } else {
                this.pos += Math.floor(totalValueLen / 2)
  //              this.keyArray = this.decodeStringTableArrayValue()
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
            } else if (this.encodingFormat === EncodingFormat.KeyTable) {
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

export class VBINRootReader {
    private reader: VBINByteReader

    constructor(data: Uint8Array) {
        if (data.length <= 0) {
            throw new Error('velojson: unexpected end of buffer')
        }
        this.reader = new VBINByteReader(data)

        const header = this.reader.readVarint()
        let wireType: number
        let encodingFormat: number
        if (header < UINT32_LIMIT) {
            wireType = header & 7
            encodingFormat = header >>> 3
        } else {
            wireType = header % 8
            encodingFormat = Math.floor(header / 8)
        }
        if (encodingFormat !== EncodingFormat.KeyID || wireType !== WireType.Object) {
            throw new Error('velojson: invalid header for decoding VBIN data')
        }
    }

    decodeBoolean(key_id: number) {
        return this.reader.readVarintIfBoolean(key_id)
    }
    decodeDouble(key_id: number) {
        return this.reader.readVarintIfBoolean(key_id)
    }
}

export class VBINObjectReader {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeBooleanValue(key_id: number, value: boolean | undefined): void {
        if (value !== undefined) {
            if (value === true) {
                this.writer.writeVarint((key_id * 8) + WireType.True)
            } else {
                this.writer.writeVarint((key_id * 8) + WireType.False)
            }
        }
    }
    encodePosIntValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.PosInt)
            this.writer.writeVarint(value)
        }
    }
    encodeDoubleValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeNumberValue(key_id: number, value: number | undefined): void {
        if (value !== undefined) {
            if (Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
                this.writer.writeVarint((key_id * 8) + WireType.PosInt)
                this.writer.writeVarint(value)
            } else {
                this.writer.writeVarint((key_id * 8) + WireType.Double)
                this.writer.writeDouble(value)
            }
        }
    }
    encodeStringValue(key_id: number, value: string | undefined): void {
        if (value !== undefined) {
            this.writer.writeVarint((key_id * 8) + WireType.String)
            this.writer.writeString(value)
        }
    }
/*    finalizeObject(key_id: number, childWriter: VBINObjectWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Object)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }*/
    finalizeArray(key_id: number, childWriter: VBINArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length * 2)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousStringArray(key_id: number, childWriter: VBINHomogenousStringArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.String)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousPosIntArray(key_id: number, childWriter: VBINHomogenousPosIntArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.PosInt)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousDoubleArray(key_id: number, childWriter: VBINHomogenousDoubleArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Double)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousObjectArray(key_id: number, childWriter: VBINHomogenousObjectArrayWriter): void {
        this.writer.writeVarint((key_id * 8) + WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Object)
        this.writer.writeBytes(body)
        childWriter.release()
    }
}

export class VBINArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeBooleanValueInArray(value: boolean): void {
        if (value === true) {
            this.writer.writeVarint(WireType.True)
        } else {
            this.writer.writeVarint(WireType.False)
        }
    }
    encodePosIntValue(value: number): void {
        if (value !== undefined) {
            this.writer.writeVarint(WireType.PosInt)
            this.writer.writeVarint(value)
        }
    }
    encodeDoubleValue(value: number): void {
        if (value !== undefined) {
            this.writer.writeVarint(WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeNumberValueInArray(value: number): void {
        if (Number.isInteger(value) && value as number >= 0 && Number.isSafeInteger(value)) {
            this.writer.writeVarint(WireType.PosInt)
            this.writer.writeVarint(value)
        } else {
            this.writer.writeVarint(WireType.Double)
            this.writer.writeDouble(value)
        }
    }
    encodeStringValueInArray(value: string): void {
        this.writer.writeVarint(WireType.String)
        this.writer.writeString(value)
    }
/*    finalizeObjectInArray(childWriter: VBINObjectWriter): void {
        this.writer.writeVarint(WireType.Object)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }*/
    finalizeArrayInArray(childWriter: VBINArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length * 2)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousStringArrayInArray(childWriter: VBINHomogenousStringArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.String)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousPosIntArrayInArray(childWriter: VBINHomogenousPosIntArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.PosInt)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousDoubleArrayInArray(childWriter: VBINHomogenousDoubleArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Double)
        this.writer.writeBytes(body)
        childWriter.release()
    }
    finalizeHomogenousObjectArrayInArray(childWriter: VBINHomogenousObjectArrayWriter): void {
        this.writer.writeVarint(WireType.Array)
        const body = childWriter.toUint8Array()
        this.writer.writeVarint((body.length * 2) + 1)
        this.writer.writeVarint(WireType.Object)
        this.writer.writeBytes(body)
        childWriter.release()
    }

}

export class VBINHomogenousStringArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeStringValueInHomogenousArray(value: string): void {
        this.writer.writeString(value)
    }
}

export class VBINHomogenousPosIntArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodePosIntValueInHomogenousArray(value: number): void {
        this.writer.writeVarint(value)
    }
}

export class VBINHomogenousDoubleArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
    encodeDoubleValueInHomogenousArray(value: number): void {
        this.writer.writeDouble(value)
    }
}

export class VBINHomogenousObjectArrayWriter {
    private writer: ByteWriter = acquireWriter()

    release(): void {
        releaseWriter(this.writer)
    }
    toUint8Array(): Uint8Array<ArrayBufferLike> {
        return this.writer.toUint8Array()
    }
/*    finalizeObjectInHomogenousArray(childWriter: VBINObjectWriter) {
        const body = childWriter.toUint8Array()
        this.writer.writeVarint(body.length)
        this.writer.writeBytes(body)
        childWriter.release()
    }*/
}
