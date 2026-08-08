import { type ByteWriter, acquireWriter, releaseWriter } from "./byte_writer.ts"
import { type JSONValue, WireType, HOMOGENEOUS_DETECTION_MIN_LENGTH, getWireType } from "./common.ts"

export function encodeArrayValue_string_table_format(writer: ByteWriter, arr: JSONValue[], writerStringTableArray: string[], writerStringTableMap: Map<string, number>): void {

    let isAllNumbers = false
    let homogeneousType: WireType | null = null
    if (arr.length >= HOMOGENEOUS_DETECTION_MIN_LENGTH) {
        let i = 0
        const first_item = arr[i]
        const firstType: WireType | null = getWireType(first_item === undefined ? null : first_item)
        if (firstType === WireType.Null || firstType === WireType.False || firstType === WireType.True) {
            homogeneousType = null
            isAllNumbers = false
        } else {
            homogeneousType = firstType
            if (firstType === WireType.PosInt || firstType === WireType.Double) {
                isAllNumbers = true
            }
            i += 1
            for (; i < arr.length; i++) {
                const item = arr[i]
                const item_wire_type = getWireType(item === undefined ? null : item)
                if (item_wire_type === WireType.Null || item_wire_type === WireType.False || item_wire_type === WireType.True) {
                    homogeneousType = null
                    isAllNumbers = false
                    break
                } else if (item_wire_type !== firstType) {
                    homogeneousType = null
                    if (!isAllNumbers) {
                        break
                    } else if (item_wire_type !== WireType.PosInt && item_wire_type !== WireType.Double) {
                        isAllNumbers = false
                        break
                    }
                }
            }
        }
    }

    const bodyWriter = acquireWriter()
    if (homogeneousType !== null) {
        bodyWriter.writeByte(homogeneousType)
        switch (homogeneousType) {
            case WireType.PosInt:
                for (let i = 0; i < arr.length; i++) {
                    bodyWriter.writeVarint(arr[i] as number)
                }
            break

            case WireType.Double:
                for (let i = 0; i < arr.length; i++) {
                    bodyWriter.writeDouble(arr[i] as number)
                }
            break

            case WireType.String:
                for (let i = 0; i < arr.length; i++) {
                    bodyWriter.writeString(arr[i] as string)
                }
            break

            case WireType.Object: {
                for (let i = 0; i < arr.length; i++) {
                    const subBodyWriter = acquireWriter()
                    const obj = arr[i] as Record<string, JSONValue>
                    for (const k of Object.keys(obj)) {
                        encodeValue_string_table_format(subBodyWriter, k, obj[k], false, writerStringTableArray, writerStringTableMap)
                    }
                    const body = subBodyWriter.toUint8Array()
                    bodyWriter.writeVarint(body.length)
                    bodyWriter.writeBytes(body)
                    releaseWriter(subBodyWriter)
                }
            break
            }

            case WireType.Array:
                for (let i = 0; i < arr.length; i++) {
                    encodeArrayValue_string_table_format(bodyWriter, arr[i] as JSONValue[], writerStringTableArray, writerStringTableMap)
                }
            break
        }
    } else if (isAllNumbers) {
        for (let i = 0; i < arr.length; i++) {
            const value = arr[i] as number
            if (Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value)) {
                bodyWriter.writeByte(WireType.PosInt)
                bodyWriter.writeVarint(value)
            } else {
                bodyWriter.writeByte(WireType.Double)
                bodyWriter.writeDouble(value)
            }
        }
    } else {
        for (const item of arr) {
            encodeValue_string_table_format(bodyWriter, null, item, true, writerStringTableArray, writerStringTableMap)
        }
    }

    const body = bodyWriter.toUint8Array()
    writer.writeVarint((body.length * 2) + (homogeneousType !== null ? 1 : 0))
    writer.writeBytes(body)
    releaseWriter(bodyWriter)
}

export function encodeValue_string_table_format(writer: ByteWriter, key: string | null, value: JSONValue, isInArray: boolean, writerStringTableArray: string[], writerStringTableMap: Map<string, number>): void {
    if (value === undefined && isInArray === false) {
        return
    }
    const wireType = getWireType((value === undefined && isInArray === true) ? null : value)
    if (key === null) {
        writer.writeVarint(wireType)
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
                encodeValue_string_table_format(bodyWriter, k, obj[k], false, writerStringTableArray, writerStringTableMap)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
            releaseWriter(bodyWriter)
        break
        }

        case WireType.Array:
            encodeArrayValue_string_table_format(writer, value as JSONValue[], writerStringTableArray, writerStringTableMap)
        break
    }
}

export function encodeStringTableValue(writer: ByteWriter, arr: string[]): void {
    const bodyWriter = acquireWriter()

    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item === undefined || item === null) {
            throw new Error('velojson: string table cannot have undefined or null values')
        }
        bodyWriter.writeString(item)
    }

    const body = bodyWriter.toUint8Array()
    writer.writeVarint(body.length)
    writer.writeBytes(body)
    releaseWriter(bodyWriter)
}
