
import { ByteReader } from "./byte_reader.ts"
import { acquireWriter, releaseWriter } from "./byte_writer.ts"
import { EncodingFormat, getWireType, WireType, type JSONValue } from "./common.ts"
import { encodeArrayValue_key_table_format, encodeKeyTableValue, encodeValue_key_table_format } from "./encode_keytable.ts"

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

    // Set writerEncodingFormat
    const writerEncodingFormat: EncodingFormat = EncodingFormat.KeyTable

    const writer = acquireWriter()

    const wireType = getWireType(value)
    writer.writeVarint((writerEncodingFormat * 8) + wireType)
    const writerStringTableMap: Map<string, number> = new Map<string, number>()
    const writerStringTableArray: string[] = []
    switch (wireType) {
        case WireType.Object: {
            const bodyWriter = acquireWriter()
            const obj = value as Record<string, JSONValue>
            for (const k of Object.keys(obj)) {
                encodeValue_key_table_format(bodyWriter, k, obj[k], false, writerStringTableArray, writerStringTableMap)
            }
            const body = bodyWriter.toUint8Array()
            writer.writeVarint(body.length)
            writer.writeBytes(body)
            releaseWriter(bodyWriter)
        break
        }
        case WireType.Array:
            encodeArrayValue_key_table_format(writer, value as JSONValue[], writerStringTableArray, writerStringTableMap)
        break
        default:
            throw new Error('velojson: KeyTable encoding format only supported for root Object or Array types')
    }
    encodeKeyTableValue(writer, writerStringTableArray)

    // .slice() here so the public function returns an exact-length,
    // independently-owned buffer, not a view into a possibly-larger
    // over-allocated backing buffer.
    const result = writer.toUint8Array().slice()
    releaseWriter(writer)
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
    if (data.length == 0) {
        return undefined
    }
    const reader = new ByteReader(data)
    return reader.decodeRootValue()
}
