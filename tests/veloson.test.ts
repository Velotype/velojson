// deno-lint-ignore-file no-explicit-any
import { encodeVSON, decodeVSON, type JSONValue } from '../src/velojson.ts'
import { describe, it } from "@std/testing/bdd"
import { fail } from "@std/assert"

function deepEqual(a: unknown, b: unknown, strict: boolean): boolean {
    if (a === b) {
        return true
    }
    if (!strict && (a === undefined || b === undefined)) {
        return (a === null || b === null)
    }
    if (typeof a !== typeof b) {
        return false
    }
    if (typeof a === 'number' && typeof b === 'number') {
        if (Number.isNaN(a) && Number.isNaN(b)) {
            return true
        }
        return a === b
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        if (Array.isArray(a) !== Array.isArray(b)) {
            return false
        }
        const aKeys = Array.isArray(a) ? Object.keys(a as object) : Object.keys(a as object).filter(k => (a as any)[k] !== undefined)
        const bKeys = Array.isArray(b) ? Object.keys(b as object) : Object.keys(b as object).filter(k => (b as any)[k] !== undefined)
        if (aKeys.length !== bKeys.length) {
            return false
        }
        return aKeys.every((k) => deepEqual((a as any)[k], (b as any)[k], strict))
    }
    return false
}

describe('test vson encoding and decoding', () => {

    const itWrap = (value: JSONValue, name: string, expectedRoundTripValue?: any) => {
        it({name,
            fn: () => {
                try {
                    // JSON UTF-8 encoded string for comparison
                    const jsonString = (value === undefined) ? "undefined" : JSON.stringify(value)
                    const encoder = new TextEncoder()
                    const jsonUtf8Bytes: Uint8Array = encoder.encode(jsonString)

                    const encoded = encodeVSON(value)
                    const decoded = decodeVSON(encoded)
                    if (expectedRoundTripValue === undefined && !deepEqual(decoded, value, false)) {
                        console.error('Expected:', jsonString, value)
                        console.error('Actual:  ', JSON.stringify(decoded), decoded)
                        fail(`ERROR: ${name} failed round-trip`)
                    } else if (expectedRoundTripValue !== undefined && !deepEqual(decoded, expectedRoundTripValue, true)) {
                        console.error('Expected:', JSON.stringify(expectedRoundTripValue), expectedRoundTripValue)
                        console.error('Actual:  ', JSON.stringify(decoded), decoded)
                        fail(`ERROR: ${name} failed explicit round-trip`)
                    } else {
                        if (encoded.length < jsonUtf8Bytes.length) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${jsonUtf8Bytes.length - encoded.length} fewer bytes)`)
                        } else if (encoded.length == jsonUtf8Bytes.length) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - same bytes)`)
                        } else if (encoded.length - jsonUtf8Bytes.length == 1) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${encoded.length - jsonUtf8Bytes.length} MORE byte)`)
                        } else {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${encoded.length - jsonUtf8Bytes.length} MORE bytes)`)
                        }
                    }
                } catch (e) {
                    console.log("Exception", e)
                    fail("ERROR: Thrown exception")
                }
            }
        })
    }
    const itBinaryWrap = (value: JSONValue, name: string, expectedBinaryValue: number[]) => {
        it({name,
            fn: () => {
                try {
                    const encoded = encodeVSON(value)
                    const encodedArray = Array.from(encoded)
                    if (!deepEqual(encodedArray, expectedBinaryValue, true)) {
                        console.error('Expected:', expectedBinaryValue)
                        console.error('Actual:  ', encodedArray)
                        fail(`ERROR: ${name} failed binary encoding`)
                    } else {
                        console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes)`)
                    }
                } catch (e) {
                    console.log("Exception", e)
                    fail("ERROR: Thrown exception")
                }
            }
        })
    }

    // Primitives
    itWrap(undefined as any, 'undefined')
    itWrap(null, 'null')
    itWrap(true, 'true')
    itWrap(false, 'false')
    itWrap(0, 'zero')
    itWrap(42, 'small positive int')
    itWrap(1000000, 'large positive int')
    itWrap(Number.MAX_SAFE_INTEGER, 'MAX_SAFE_INTEGER')
    itWrap(-17, 'negative int (-> double)')
    itWrap(3.14159, 'float')
    itWrap(-2.5, 'negative float')
    itWrap('', 'empty string')
    itWrap('hello, world!', 'ascii string')
    itWrap('héllo 🌍 世界', 'unicode string')

    // Arrays
    itWrap([], 'empty array')
    itWrap([1, 2, 3], 'flat array')
    itWrap([1, undefined as any, 2, 3], 'flat array', [1, null as any, 2, 3])
    itWrap([1, 'two', true, null, 3.5, [4, 5]], 'mixed nested array')

    // Objects
    itWrap({}, 'empty object')
    itWrap({ a: 1, b: 'two', c: null, d: true }, 'flat object')
    const protoObject = Object.create(null)
    protoObject.a = 1
    protoObject.b = 'two'
    protoObject.c = undefined
    protoObject.__proto__ = "test __proto__"
    protoObject.prototype = "test prototype"
    protoObject.constructor = "test constructor"
    protoObject.d = null
    itWrap(protoObject, 'flat object with restricted keys')
    itWrap(
        {
            name: 'velojson',
            version: 1,
            tags: ['binary', 'json', 'wire-format'],
            meta: { author: 'test', stable: false, ratio: -0.5 },
        },
        'nested object'
    )

    // Larger structural test
    const big = {
        users: Array.from({ length: 50 }, (_, i) => ({
            id: i,
            name: `user_${i}`,
            active: i % 2 === 0,
            score: i * 1.5,
            tags: i % 3 === 0 ? ['vip', 'early'] : [],
        })),
    }
    itWrap(big, 'larger structure (50 users)')

    itBinaryWrap({ a: 1 }, "Simple object encoding", [ 6, 3, 11, 97, 1 ])
    itBinaryWrap({ a: 1, b: 'two', c: true, d: null }, 'flat object encoding', [6, 13, 11, 97, 1, 13, 98, 3, 116, 119, 111, 10, 99, 8, 100])
    itBinaryWrap([1, undefined as any, 2, 3], 'flat arrayencoding', [7, 14, 3, 1, 0, 3, 2, 3, 3])

    // Larger structural test
    const bigTricky = {
        users: Array.from({ length: 50 }, (_, i) => ({
            id: i,
            name: `user_${i}`,
            active: i % 2 === 0,
            score: i * 1.5,
            score_history: Array.from({ length: 1000 }, (_, index) => index + 1.223791),
            tags: i % 3 === 0 ? ['vip', 'early'] : [],
        })),
    }
    it({
        name: "Faster than JSON.parse(JSON.stringify(obj)) for an object with many tricky numbers",
        fn: () => {
            try {
                const iterations = 1000
                const startJSON = performance.now()
                let totalLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = JSON.parse(JSON.stringify(bigTricky))
                    totalLen += obj.users.length
                }
                const endJSON = performance.now()
                const timeJSON = endJSON - startJSON

                const startVSON = performance.now()
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = decodeVSON(encodeVSON(bigTricky))
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: failed to be faster than JSON.parse(JSON.stringify()) VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  (${timeVSON - timeJSON} faster than JSON.parse(JSON.stringify()) after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "Faster than JSON.stringify(obj) for an object with many tricky numbers",
        fn: () => {
            try {
                const iterations = 2000
                const startJSON = performance.now()
                let totalJLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const str = JSON.stringify(bigTricky)
                    totalJLen += str.length
                }
                const endJSON = performance.now()
                const timeJSON = endJSON - startJSON

                const startVSON = performance.now()
                let totalVLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const str = encodeVSON(bigTricky)
                    totalVLen += str.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.stringify(obj)".padEnd(28)} failed to be faster than JSON.stringify() VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen}`)
                } else {
                    console.log(`OK  ${"JSON.stringify(obj)".padEnd(28)} (${timeVSON - timeJSON} faster than JSON.stringify() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen})`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "Faster than JSON.parse(obj) for an object with many tricky numbers",
        fn: () => {
            try {
                const iterations = 2000
                const startJSON = performance.now()
                const strObj = JSON.stringify(bigTricky)
                let totalLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = JSON.parse(strObj)
                    totalLen += obj.users.length
                }
                const endJSON = performance.now()
                const timeJSON = endJSON - startJSON

                const startVSON = performance.now()
                const binObj = encodeVSON(bigTricky)
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = decodeVSON(binObj) as any
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.parse(obj)".padEnd(28)} failed to be faster than JSON.parse() VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  ${"JSON.parse(obj)".padEnd(28)} (${timeVSON - timeJSON} faster than JSON.parse() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
})
