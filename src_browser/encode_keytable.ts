import { type ByteWriter, acquireWriter } from "./byte_writer.ts"
import { type JSONValue, WireType, getWireType, boom } from "./common.ts"

/** Encodes `obj`'s fields into a fresh length-prefixed body and appends it to `writer`.
 *  Shared by the three call sites that all used to duplicate this acquire/loop/length-prefix/release dance. */
export function encodeObjectBody(writer: ByteWriter, obj: Record<string, JSONValue>, writerKeyTableArray: string[], writerKeyTableMap: Map<string, number>): void {
    const bodyWriter = acquireWriter()
    for (const k of Object.keys(obj)) {
        encodeValue_key_table_format(bodyWriter, k, obj[k], false, writerKeyTableArray, writerKeyTableMap)
    }
    const body = bodyWriter.u8()
    writer.wv(body.length)
    writer.wn(body)
}

export function encodeArrayValue_key_table_format(writer: ByteWriter, arr: JSONValue[], writerKeyTableArray: string[], writerKeyTableMap: Map<string, number>): void {
    const bodyWriter = acquireWriter()
    for (const item of arr) {
        encodeValue_key_table_format(bodyWriter, null, item, true, writerKeyTableArray, writerKeyTableMap)
    }
    const body = bodyWriter.u8()
    writer.wv(body.length * 2)
    writer.wn(body)
}

export function encodeValue_key_table_format(writer: ByteWriter, key: string | null, value: JSONValue, isInArray: boolean, writerKeyTableArray: string[], writerKeyTableMap: Map<string, number>): void {
    if (value === undefined && !isInArray) {
        return
    }
    const wireType = getWireType(value === undefined && isInArray ? null : value)
    if (key === null) {
        writer.wv(wireType)
    } else {
        let keyIndex = writerKeyTableMap.get(key)
        if (keyIndex === undefined) {
            writerKeyTableArray.push(key)
            keyIndex = writerKeyTableArray.length
            writerKeyTableMap.set(key, keyIndex)
        }
        writer.wv(keyIndex * 8 + wireType)
    }

    switch (wireType) {
        case WireType.P:
            writer.wv(value as number)
        break

        case WireType.D:
            writer.wd(value as number)
        break

        case WireType.S:
            writer.ws(value as string)
        break

        case WireType.O:
            encodeObjectBody(writer, value as Record<string, JSONValue>, writerKeyTableArray, writerKeyTableMap)
        break

        case WireType.A:
            encodeArrayValue_key_table_format(writer, value as JSONValue[], writerKeyTableArray, writerKeyTableMap)
        break

        // Null / False / True have no payload — nothing to write.
    }
}

export function encodeKeyTableValue(writer: ByteWriter, arr: string[]): void {
    const bodyWriter = acquireWriter()

    for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item === undefined || item === null) {
            boom() // 'KeyTable invalid'
        }
        bodyWriter.ws(item)
    }

    const body = bodyWriter.u8()
    writer.wv(body.length)
    writer.wn(body)
}