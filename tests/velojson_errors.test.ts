import { VSON, EncodingFormat, VBIN, type VBINObjectMapper, VBINRootWriter, VBINObjectWriter } from '../src_server/velojson.ts'
import { VSON as VSON_browser } from '../src_browser/velojson.ts'
import { describe, it } from "@std/testing/bdd"
import { assertThrows } from "@std/assert"

// Correctness of the wire format also means failing loudly on malformed or
// corrupted input rather than silently producing wrong data. None of this
// is covered by the main round-trip suite, which only ever feeds the
// decoder data the encoder itself produced. Byte sequences below are
// hand-derived from the format spec in readme.md (verified against the
// exact bytes the encoder produces for equivalent values) and target each
// distinct guard in byte_reader.ts.

describe('malformed input / decode error handling', () => {

    it('throws on a truncated buffer (unexpected end of buffer)', () => {
        const good = VSON.encode({ a: 1 }, EncodingFormat.Base) // [6, 3, 11, 97, 1]
        assertThrows(() => VSON.decode(good.slice(0, good.length - 1)), Error, 'unexpected end of buffer')
    })

    it('throws on a varint with no terminating byte (corrupt data)', () => {
        assertThrows(() => VSON.decode(new Uint8Array(12).fill(0xff)), Error, 'varint too long')
    })

    it('throws on an unrecognized encoding format', () => {
        // header byte: (encodingFormat=3 << 3) | wireType=0 -> 24
        assertThrows(() => VSON.decode(new Uint8Array([24])), Error, 'unrecognized encoding format')
    })

    it('throws when KeyTable format is used with a non-object/array root wire type', () => {
        // header byte: (encodingFormat=1 << 3) | wireType=PosInt(3) -> 11
        assertThrows(() => VSON.decode(new Uint8Array([11])), Error, 'KeyTable encoding format only valid for Object and Array root values')
    })

    it('throws when KeyID format is used with a non-object root wire type', () => {
        // header byte: (encodingFormat=2 << 3) | wireType=Array(7) -> 23
        assertThrows(() => VSON.decode(new Uint8Array([23])), Error, 'KeyIDs encoding format only valid for Object root values')
    })

    it('throws when encoding a scalar root value with the KeyTable format explicitly', () => {
        assertThrows(() => VSON.encode(42, EncodingFormat.KeyTable), Error, 'KeyTable encoding format only supported for root Object or Array types')
    })

    it('throws on invalid UTF-8 in an encoded string', () => {
        // header=5 (Base, String), length=1, followed by a lone 0xFF byte (invalid standalone UTF-8)
        assertThrows(() => VSON.decode(new Uint8Array([5, 1, 0xff])))
    })

    it('throws when a homogeneous array declares a zero-payload shared wire type', () => {
        // root: Array (header=7); body: length=1,homogeneous=1 (varint=3); sharedType=True(2)
        assertThrows(() => VSON.decode(new Uint8Array([7, 3, 2])), Error, 'homogeneous array cannot use a zero-payload wire type')
    })

    it('throws when a non-homogeneous array entry carries a key', () => {
        // root: Array (header=7); body: length=1,homogeneous=0 (varint=2); entry header keyLen=1,wireType=True(2) -> 10
        assertThrows(() => VSON.decode(new Uint8Array([7, 2, 10])), Error, 'array entry must not have a key')
    })

    it('throws on an out-of-bounds KeyTable key index', () => {
        const encoded = VSON.encode({ a: 1 }, EncodingFormat.KeyTable) // [14, 2, 11, 1, 2, 1, 97]
        const corrupted = new Uint8Array(encoded)
        corrupted[2] = (3 * 8) + 3 // keyIndex=3, but only one key ("a") exists
        assertThrows(() => VSON.decode(corrupted), Error, 'key index out of bounds')
    })

    it('throws when a homogeneous array-of-arrays is decoded through a VBIN mapper', () => {
        // Hand-built VBIN buffer: root object { 1: <homogeneous array of arrays, 0 items> }.
        // No public VBIN writer can produce this shape (there is no homogeneous
        // array-of-arrays writer), but the decoder must still defend against it
        // since VSON.decode()'s debug path and any hand-rolled encoder could reach it.
        const dummyMapper: VBINObjectMapper = {
            assignValue: () => {},
            hasAllRequiredFields: () => true,
            fieldMapper: () => undefined,
        }
        // [22]: header (KeyID<<3 | Object). [3]: object body length.
        // [15]: field header (keyID=1<<3 | Array=7). [3]: array length=1,homogeneous=1. [7]: sharedType=Array.
        assertThrows(() => VBIN.decode(new Uint8Array([22, 3, 15, 3, 7]), dummyMapper), Error, 'VBIN Array not allowed to contain nested arrays')
    })

    it('browser decoder rejects a Base-format buffer (browser only supports KeyTable)', () => {
        const baseEncoded = VSON.encode({ a: 1 }, EncodingFormat.Base)
        assertThrows(() => VSON_browser.decode(baseEncoded))
    })

    it('browser decoder rejects a VBIN/KeyID-format buffer (browser only supports KeyTable)', () => {
        const root = new VBINRootWriter()
        const obj = root.startRootObject()
        obj.encodePosIntValue(1, 1)
        root.finalizeRootObject(obj)
        const encoded = root.toUint8ArrayAndRelease()
        assertThrows(() => VSON_browser.decode(encoded))
    })
})
