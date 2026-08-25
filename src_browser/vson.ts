import { ByteReader } from "./byte_reader.ts"
import { acquireWriter } from "./byte_writer.ts"
import { boom, getWireType, WireType, type JSONValue } from "./common.ts"
import { encodeArrayValue_key_table_format, encodeKeyTableValue, encodeObjectBody } from "./encode_keytable.ts"

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
// deno-lint-ignore no-explicit-any
export function encodeVSON(value: any): Uint8Array<ArrayBuffer> {
    if (value === undefined) {
        return new Uint8Array()
    }

    const writer = acquireWriter()

    const wireType = getWireType(value)
    writer.wv(8 + wireType) // Note this directly encodes (1 * 8) from (EncodingFormat.KeyTable * 8)

    const writerStringTableMap: Map<string, number> = new Map<string, number>()
    const writerStringTableArray: string[] = []

    if (wireType === WireType.O) {
        encodeObjectBody(writer, value as Record<string, JSONValue>, writerStringTableArray, writerStringTableMap)
    } else if (wireType === WireType.A) {
        encodeArrayValue_key_table_format(writer, value as JSONValue[], writerStringTableArray, writerStringTableMap)
    } else {
        boom() // 'value invalid'
    }
    encodeKeyTableValue(writer, writerStringTableArray)

    // .slice() here so the public function returns an exact-length,
    // independently-owned buffer, not a view into a possibly-larger
    // over-allocated backing buffer.
    const result = writer.u8().slice()
    return result
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
// deno-lint-ignore no-explicit-any
export function decodeVSON(data: Uint8Array): any {
    if (data.length === 0) {
        return undefined
    }
    return new ByteReader(data).dR()
}