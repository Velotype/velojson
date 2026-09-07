// deno-lint-ignore-file no-explicit-any
import { VSON, type JSONValue, EncodingFormat } from '../src_server/velojson.ts'
import { VSON as VSON_browser } from '../src_browser/velojson.ts'
import { HOMOGENEOUS_DETECTION_MIN_LENGTH } from '../src_server/common.ts'
import { describe, it } from "@std/testing/bdd"
import { fail } from "@std/assert"
import { deepEqual } from "./test_utils.ts"

// Arrays at or above HOMOGENEOUS_DETECTION_MIN_LENGTH trigger automatic
// homogeneous-array encoding in the server's Base/KeyTable writers (see
// encode_base.ts / encode_keytable.ts). The main test suite never exercises
// this path with a strict correctness check (only via loose perf-timing
// tests), so this file verifies round-trip correctness for every branch of
// that detection logic: single-wire-type homogeneous arrays (PosInt, Double,
// String, Object, Array), the "mixed int/double" numeric fallback, and the
// full heterogeneous fallback when a large array can't be homogenized.
//
// The browser build's KeyTable encoder never performs this detection (it
// always emits the flat/heterogeneous form), but its decoder must still be
// able to read homogeneous data produced by the server encoder, since both
// builds are expected to interoperate over the same wire format. Cases
// marked `checkBrowser` verify that.

describe('homogeneous array detection and round-tripping', () => {

    function checkRoundTrip(value: JSONValue, format: EncodingFormat, checkBrowser: boolean, name: string) {
        it({
            name,
            fn: () => {
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
                        console.error('Expected:       ', JSON.stringify(value))
                        console.error('Actual (browser):', JSON.stringify(decodedBrowser))
                        fail(`ERROR: ${name} failed browser round-trip`)
                    }
                }
            }
        })
    }

    const N = HOMOGENEOUS_DETECTION_MIN_LENGTH

    // --- Homogeneous PosInt array ---
    const posIntItems = { items: Array.from({ length: N + 36 }, (_, i) => i) }
    checkRoundTrip(posIntItems, EncodingFormat.Base, false, 'homogeneous PosInt array - Base')
    checkRoundTrip(posIntItems, EncodingFormat.KeyTable, true, 'homogeneous PosInt array - KeyTable')

    // --- Homogeneous Double array ---
    const doubleItems = { items: Array.from({ length: N + 36 }, (_, i) => i + 0.25) }
    checkRoundTrip(doubleItems, EncodingFormat.Base, false, 'homogeneous Double array - Base')
    checkRoundTrip(doubleItems, EncodingFormat.KeyTable, true, 'homogeneous Double array - KeyTable')

    // --- Homogeneous String array ---
    const stringItems = { items: Array.from({ length: N + 16 }, (_, i) => `item_${i}`) }
    checkRoundTrip(stringItems, EncodingFormat.Base, false, 'homogeneous String array - Base')
    checkRoundTrip(stringItems, EncodingFormat.KeyTable, true, 'homogeneous String array - KeyTable')

    // --- Homogeneous Object array ---
    const objectItems = { items: Array.from({ length: N }, (_, i) => ({ id: i, label: `obj_${i}`, ok: i % 2 === 0 })) }
    checkRoundTrip(objectItems, EncodingFormat.Base, false, 'homogeneous Object array - Base')
    checkRoundTrip(objectItems, EncodingFormat.KeyTable, true, 'homogeneous Object array - KeyTable')

    // --- Homogeneous Array-of-arrays ---
    const arrayItems = { items: Array.from({ length: N }, (_, i) => [i, i * 2, i * 3]) }
    checkRoundTrip(arrayItems, EncodingFormat.Base, false, 'homogeneous Array-of-arrays - Base')
    checkRoundTrip(arrayItems, EncodingFormat.KeyTable, true, 'homogeneous Array-of-arrays - KeyTable')

    // --- Mixed PosInt/Double numeric array (isAllNumbers fallback, not a single homogeneousType) ---
    const mixedNumbers = { items: Array.from({ length: N + 36 }, (_, i) => (i % 2 === 0 ? i : i + 0.5)) }
    checkRoundTrip(mixedNumbers, EncodingFormat.Base, false, 'mixed int/double large array - Base')
    checkRoundTrip(mixedNumbers, EncodingFormat.KeyTable, true, 'mixed int/double large array - KeyTable')

    // --- Large array that can't be homogenized at all (forces the fully heterogeneous fallback) ---
    const heterogeneousLarge = {
        items: Array.from({ length: N + 6 }, (_, i) => {
            if (i === 0) return null
            if (i === 1) return true
            if (i === 2) return 'a string'
            if (i === 3) return [1, 2]
            return i
        })
    }
    checkRoundTrip(heterogeneousLarge, EncodingFormat.Base, false, 'large mixed-type array forces heterogeneous - Base')
    checkRoundTrip(heterogeneousLarge, EncodingFormat.KeyTable, true, 'large mixed-type array forces heterogeneous - KeyTable')

    // --- Boundary around the detection threshold itself ---
    const atThreshold = { items: Array.from({ length: N }, (_, i) => i) }
    checkRoundTrip(atThreshold, EncodingFormat.Base, false, `array length exactly at threshold (${N}) - Base`)
    checkRoundTrip(atThreshold, EncodingFormat.KeyTable, true, `array length exactly at threshold (${N}) - KeyTable`)

    const belowThreshold = { items: Array.from({ length: N - 1 }, (_, i) => i) }
    checkRoundTrip(belowThreshold, EncodingFormat.Base, false, `array length one below threshold (${N - 1}) - Base`)
    checkRoundTrip(belowThreshold, EncodingFormat.KeyTable, true, `array length one below threshold (${N - 1}) - KeyTable`)

    // --- Homogeneous array as the bare root value (not nested inside an object) ---
    const bareRootArray = Array.from({ length: N + 10 }, (_, i) => i)
    checkRoundTrip(bareRootArray, EncodingFormat.KeyTable, true, 'homogeneous array as bare root value - KeyTable')
})
