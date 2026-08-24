
import { ByteReader } from "./byte_reader.ts"
import { acquireWriter, releaseWriter } from "./byte_writer.ts"
import { EncodingFormat, getWireType, type VBINObjectMapper, WireType, type JSONValue } from "./common.ts"
import { encodeValue_base_format } from "./encode_base.ts"
import { encodeArrayValue_key_table_format, encodeKeyTableValue, encodeValue_key_table_format } from "./encode_keytable.ts"

/**
 * Encode any JSON-representable value into a VSON binary buffer.
 *
 * Note: Will throw on encoding errors
 *
 * @param [EncodingFormat] encodingFormat - defaults to KeyTable if the value is an object or array
 *
 * Example:
 * ```ts
 * const obj = { name: "Some name", age: 20, address: null }
 * const objBinary: Uint8Array = encodeVSON(obj)
 * ```
 */
// deno-lint-ignore no-explicit-any
export function encodeVSON(value: any, encodingFormat?: EncodingFormat): Uint8Array<ArrayBuffer> {
    if (value === undefined) {
        return new Uint8Array()
    }

    // Set writerEncodingFormat
    let writerEncodingFormat: EncodingFormat
    if (encodingFormat === undefined) {
        if (value !== null && (typeof value === "object" || Array.isArray(value))) {
            writerEncodingFormat = EncodingFormat.KeyTable
        } else {
            writerEncodingFormat = EncodingFormat.Base
        }
    } else {
        writerEncodingFormat = encodingFormat
    }

    const writer = acquireWriter()
    if (writerEncodingFormat === EncodingFormat.Base) {
        encodeValue_base_format(writer, null, value, false)
    } else if (writerEncodingFormat === EncodingFormat.KeyTable) {
        const wireType = getWireType(value)
        writer.writeVarint((writerEncodingFormat * 8) + wireType)
        const writerKeyTableMap: Map<string, number> = new Map<string, number>()
        const writerKeyTableArray: string[] = []
        switch (wireType) {
            case WireType.Object: {
                const bodyWriter = acquireWriter()
                const obj = value as Record<string, JSONValue>
                for (const k of Object.keys(obj)) {
                    encodeValue_key_table_format(bodyWriter, k, obj[k], false, writerKeyTableArray, writerKeyTableMap)
                }
                const body = bodyWriter.toUint8Array()
                writer.writeVarint(body.length)
                writer.writeBytes(body)
                releaseWriter(bodyWriter)
            break
            }
            case WireType.Array:
                encodeArrayValue_key_table_format(writer, value as JSONValue[], writerKeyTableArray, writerKeyTableMap)
            break
            default:
                throw new Error('velojson: KeyTable encoding format only supported for root Object or Array types')
        }
        encodeKeyTableValue(writer, writerKeyTableArray)
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

/**
 * Decode a VBIN binary buffer back into a JSON-representable value.
 *
 * Note: Will throw on decoding errors
 *
 * Example:
 * ```ts
 * const startObj = { name: "Some name", age: 20, address: null }
 * const objBinary: Uint8Array = encodeVSON(startObj)
 * const endObj = decodeVBIN(objBinary, mapper)
 *
 * console.log(JSON.stringify(endObj))
 * // Expected output: {"name":"Some name","age":20,"address":null}
 * ```
 */
// deno-lint-ignore no-explicit-any
export function decodeVBIN(data: Uint8Array, mapper: VBINObjectMapper): any {
    if (data.length == 0) {
        return undefined
    }
    const reader = new ByteReader(data)
    return reader.decodeRootValue(mapper)
}
