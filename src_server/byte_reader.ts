import { EncodingFormat, type JSONValue, textDecoder, UINT32_LIMIT, VBINObjectMapper, WireType } from "./common.ts";

export class ByteReader {
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
                throw new Error('velojson: varint too long (corrupt data)')
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

    private decodeObjectValue(mapper?: VBINObjectMapper): Record<string, JSONValue> {
        const len = this.readVarint()
        // enterSection
        if (this.pos + len > this.limit) {
            throw new Error(`velojson: unexpected end of buffer ${this.pos} ${len} ${this.limit}`)
        }
        const previousLimit = this.limit
        this.limit = this.pos + len

        // Create a null prototype object so that the __proto__ key is not restricted
        // See: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object#null-prototype_objects
        const obj: Record<string, JSONValue> = Object.create(null)
        while (this.limit > this.pos) {
            this.decodeObjectFieldValue(obj, mapper)
        }
        // exitSection
        this.pos = this.limit
        this.limit = previousLimit
        if (mapper !== undefined && !mapper.hasAllRequiredFields(obj)) {
            throw new Error('velojson: missing required field')
        }
        return obj
    }

    private decodeArrayValue(keyData?: number, mapper?: VBINObjectMapper): JSONValue[] {
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
            throw new Error(`velojson: unexpected end of buffer ${this.pos} ${len} ${this.limit}`)
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
                case WireType.Object: {
                    if (mapper !== undefined) {
                        if (keyData === undefined) {
                            throw new Error("velojson: missing keyID")
                        }
                        const fieldMapper = mapper.fieldMapper(keyData)
                        if (fieldMapper === undefined) {
                            throw new Error(`velojson: unknown field keyID ${keyData}`)
                        }
                        arr = []
                        while (this.limit > this.pos) {
                            arr.push(this.decodeObjectValue(fieldMapper))
                        }
                    } else {
                        arr = []
                        while (this.limit > this.pos) {
                            arr.push(this.decodeObjectValue())
                        }
                    }
                break
                }
                case WireType.Array:
                    if (mapper !== undefined) {
                        throw new Error("velojson: VBIN Array not allowed to contain nested arrays")
                    }
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
                arr.push(this.decodeArrayEntryValue(mapper))
            }
        }

        // exitSection
        this.pos = this.limit
        this.limit = previousLimit
        return arr
    }

    private decodeKeyTableArrayValue(): string[] {
        const len = this.readVarint()

        // enterSection
        if (this.pos + len > this.limit) {
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

    decodeRootValue(mapper?: VBINObjectMapper): JSONValue {
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
        } else if (encodingFormat === EncodingFormat.KeyTable) {
            if (wireType !== WireType.Object && wireType !== WireType.Array) {
                throw new Error('velojson: KeyTable encoding format only valid for Object and Array root values')
            }
            const pos = this.pos
            const totalValueLen = this.readVarint()
            if (wireType === WireType.Object) {
                this.pos += totalValueLen
                this.keyArray = this.decodeKeyTableArrayValue()
                this.pos = pos
                return this.decodeObjectValue()
            } else {
                this.pos += Math.floor(totalValueLen / 2)
                this.keyArray = this.decodeKeyTableArrayValue()
                this.pos = pos
                return this.decodeArrayValue()
            }
        } else if (encodingFormat === EncodingFormat.KeyID) {
            if (wireType !== WireType.Object) {
                throw new Error('velojson: KeyIDs encoding format only valid for Object root values')
            }
            return this.decodeObjectValue(mapper)
        } else {
            throw new Error('velojson: unrecognized encoding format')
        }
    }

    private decodeObjectFieldValue(obj: Record<string, JSONValue>, mapper?: VBINObjectMapper) {
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
            } else if (this.encodingFormat === EncodingFormat.KeyID) {
                if (mapper === undefined) {
                    key = String(keyData)
                } else {
                    switch (wireType) {
                        case WireType.Null:
                            mapper.assignValue(obj, keyData, null)
                        break
                        case WireType.False:
                            mapper.assignValue(obj, keyData, false)
                        break
                        case WireType.True:
                            mapper.assignValue(obj, keyData, true)
                        break
                        case WireType.PosInt:
                            mapper.assignValue(obj, keyData, this.readVarint())
                        break
                        case WireType.Double:
                            mapper.assignValue(obj, keyData, this.readDouble())
                        break
                        case WireType.String:
                            mapper.assignValue(obj, keyData, this.readString())
                        break
                        case WireType.Object: {
                            const fieldMapper = mapper.fieldMapper(keyData)
                            if (fieldMapper === undefined) {
                                throw new Error(`velojson: unknown field keyID ${keyData}`)
                            }
                            mapper.assignValue(obj, keyData, this.decodeObjectValue(fieldMapper))
                        break
                        }
                        case WireType.Array:
                            mapper.assignValue(obj, keyData, this.decodeArrayValue(keyData, mapper))
                        break
                        default:
                            throw new Error(`velojson: unknown wire type ${wireType}`)
                    }
                    return
                }
            } else {
                throw new Error('velojson: encoding format not recognized')
            }
        } else {
            throw new Error('velojson: object field is missing a required key')
        }

        // Plain assignment is safe here because obj has no prototype at
        // all, so there's no inherited __proto__ accessor to trigger
        switch (wireType) {
            case WireType.Null:
                obj[key] = null
            break
            case WireType.False:
                obj[key] = false
            break
            case WireType.True:
                obj[key] = true
            break
            case WireType.PosInt:
                obj[key] = this.readVarint()
            break
            case WireType.Double:
                obj[key] = this.readDouble()
            break
            case WireType.String:
                obj[key] = this.readString()
            break
            case WireType.Object:
                obj[key] = this.decodeObjectValue()
            break
            case WireType.Array:
                obj[key] = this.decodeArrayValue()
            break
            default:
                throw new Error(`velojson: unknown wire type ${wireType}`)
        }
    }
    private decodeArrayEntryValue(mapper?: VBINObjectMapper): JSONValue {
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

        if (keyData > 0) {
            throw new Error('velojson: array entry must not have a key')
        }

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
            case WireType.Object: {
                if (mapper !== undefined) {
                    throw new Error("velojson: VBIN Non-homogenous Array not allowed to contain Object")
                }
                return this.decodeObjectValue()
            }
            case WireType.Array: {
                if (mapper !== undefined) {
                    throw new Error("velojson: VBIN Non-homogenous Array not allowed to contain Array")
                }
                return this.decodeArrayValue()
            }
            default:
                throw new Error(`velojson: unknown wire type ${wireType}`)
        }
    }
}
