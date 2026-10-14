// deno-lint-ignore-file no-explicit-any
import { VSON, type JSONValue, EncodingFormat, VBIN, VBINRootWriter, VBINHomogenousDoubleArrayWriter, type VBINObjectMapper } from '../src_server/velojson.ts'
import { VSON as VSON_browser } from '../src_browser/velojson.ts'
import { HOMOGENEOUS_DETECTION_MIN_LENGTH } from '../src_server/common.ts'
import { describe, it } from "@std/testing/bdd"
import { assertThrows, fail } from "@std/assert"
import { deepEqual } from "./test_utils.ts"

// Regression tests for round-trip bugs found by differential testing against
// a native (Rust) VSON implementation.

function roundTrip(value: JSONValue, format: EncodingFormat | undefined, checkBrowser: boolean, name: string) {
    const encoded = VSON.encode(value, format)
    const decoded = VSON.decode(encoded)
    if (!deepEqual(decoded, value, true)) {
        console.error('Expected:', JSON.stringify(value))
        console.error('Actual:  ', JSON.stringify(decoded))
        fail(`ERROR: ${name} failed round-trip`)
    }
    if (checkBrowser) {
        const decodedBrowser = VSON_browser.decode(encoded)
        if (!deepEqual(decodedBrowser, value, true)) {
            console.error('Expected:        ', JSON.stringify(value))
            console.error('Actual (browser):', JSON.stringify(decodedBrowser))
            fail(`ERROR: ${name} failed browser round-trip`)
        }
    }
}

describe('large mixed int/double array followed by a non-number', () => {
    // The KeyTable encoder used to stop checking entries once it saw a
    // PosInt/Double mix, then wrote every non-PosInt entry as a double:
    // null became 0, strings and objects became NaN.
    const N = HOMOGENEOUS_DETECTION_MIN_LENGTH
    const ints = Array.from({ length: N - 1 }, (_, i) => i)
    const cases: [string, JSONValue[]][] = [
        ['then null', [...ints, 2.5, null]],
        ['then string', [...ints, 2.5, 's']],
        ['then object', [...ints, 2.5, { a: 1 }]],
        ['then array', [...ints, 2.5, [1]]],
        ['then boolean', [...ints, 2.5, true]],
        ['double first, then int, then string', [0.5, ...ints, 'x']],
    ]
    for (const [name, arr] of cases) {
        for (const format of [EncodingFormat.Base, EncodingFormat.KeyTable]) {
            const label = `${name} - ${EncodingFormat[format]}`
            it(label, () => roundTrip({ items: arr }, format, format === EncodingFormat.KeyTable, label))
        }
    }
})

describe('strings beginning with U+FEFF', () => {
    // TextDecoder strips a leading byte-order mark by default, which dropped
    // the character from any decoded string that started with it.
    const value = { s: '﻿abc', list: ['﻿', '﻿﻿x'], '﻿key': 1 }
    it('server - KeyTable', () => roundTrip(value, EncodingFormat.KeyTable, true, 'BOM KeyTable'))
    it('server - Base', () => roundTrip(value, EncodingFormat.Base, false, 'BOM Base'))
    it('browser encoder', () => {
        const decoded = VSON_browser.decode(VSON_browser.encode(value))
        if (!deepEqual(decoded, value, true)) {
            fail(`ERROR: browser round-trip got ${JSON.stringify(decoded)}`)
        }
    })
    it('homogeneous string array', () => {
        const arr = Array.from({ length: HOMOGENEOUS_DETECTION_MIN_LENGTH }, (_, i) => '﻿' + i)
        roundTrip(arr, EncodingFormat.KeyTable, true, 'BOM homogeneous')
    })
})

describe('empty-string object keys', () => {
    // The Base encoder writes "" as a zero-length key, which the decoder
    // used to reject as a missing key.
    const value = { '': 1, a: { '': [null, { '': 'x' }] } }
    it('Base', () => roundTrip(value, EncodingFormat.Base, false, 'empty key Base'))
    it('KeyTable', () => roundTrip(value, EncodingFormat.KeyTable, true, 'empty key KeyTable'))
    it('KeyTable key index 0 is still rejected', () => {
        // {KeyTable, Object} header, 1-byte body holding a field with key index 0 (null), empty key table
        const bytes = new Uint8Array([1 * 8 + 6, 1, 0, 0])
        assertThrows(() => VSON.decode(bytes), Error, 'missing a required key')
    })
})

describe('empty homogeneous double arrays', () => {
    // The decoders required at least one double after the Double type byte,
    // so an empty homogeneous double array (what
    // VBINHomogenousDoubleArrayWriter writes for no values) failed to decode.
    it('VSON: server and browser decode [] ', () => {
        // {Base, Array}{length 1 * 2 + homogeneous}{Double}
        const bytes = new Uint8Array([7, 3, 4])
        if (!deepEqual(VSON.decode(bytes), [], true)) fail('server')
        // {KeyTable, Array}{length}{Double}{empty key table}
        const kt = new Uint8Array([15, 3, 4, 0])
        if (!deepEqual(VSON_browser.decode(kt), [], true)) fail('browser')
    })
    it('VBIN: empty VBINHomogenousDoubleArrayWriter round-trips', () => {
        const root = new VBINRootWriter(), w = root.startRootObject()
        w.finalizeHomogenousDoubleArray(1, new VBINHomogenousDoubleArrayWriter())
        root.finalizeRootObject(w)
        const mapper: VBINObjectMapper = {
            assignValue: (o, _k, v) => { o.values = v },
            hasAllRequiredFields: () => true,
            fieldMapper: () => undefined,
        }
        const decoded = VBIN.decode(root.toUint8ArrayAndRelease() as Uint8Array<ArrayBuffer>, mapper)
        if (!deepEqual(decoded.values, [], true)) fail(JSON.stringify(decoded))
    })
    it('still rejects a length that is not a multiple of 8', () => {
        assertThrows(() => VSON.decode(new Uint8Array([7, 7, 4, 1, 2])))
    })
})

describe('VBIN.decode only accepts VBIN messages', () => {
    // A Base or KeyTable message passed to VBIN.decode used to decode as plain
    // VSON, ignoring the mapper (e.g. returning a bare number).
    const mapper: VBINObjectMapper = { assignValue: () => {}, hasAllRequiredFields: () => true, fieldMapper: () => undefined }
    it('rejects a Base message', () => {
        assertThrows(() => VBIN.decode(new Uint8Array([3, 132, 1]), mapper), Error, 'requires a VBIN')
    })
    it('rejects a KeyTable message', () => {
        assertThrows(() => VBIN.decode(VSON.encode({ a: 1 }), mapper), Error, 'requires a VBIN')
    })
})
