// deno-lint-ignore-file no-explicit-any
import { VSON, type JSONValue, EncodingFormat, VBINRootWriter, VBINObjectWriter, VBINHomogenousStringArrayWriter, VBINHomogenousObjectArrayWriter, VBINObjectMapper, VBIN } from '../src_server/velojson.ts'
import { VSON as VSON_browser } from '../src_browser/velojson.ts'
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

type BigObjType = {
    users: { // keyid = 1
        id: number // keyid = 1
        name: string // keyid = 2
        active: boolean // keyid = 3
        score: number // keyid = 4
        tags: string[] // keyid = 5
    }[]
}

function encodeBigObj(inObj: BigObjType): Uint8Array<ArrayBufferLike> {
    const rootWriter = new VBINRootWriter()
    const rootObj = rootWriter.startRootObject()
    const usersArray = new VBINHomogenousObjectArrayWriter()
    inObj.users.forEach(userObj => {
        const userVBIN = new VBINObjectWriter()
        userVBIN.encodePosIntValue(1, userObj.id)
        userVBIN.encodeStringValue(2, userObj.name)
        userVBIN.encodeBooleanValue(3, userObj.active)
        userVBIN.encodeNumberValue(4, userObj.score)
        const tagsArray = new VBINHomogenousStringArrayWriter()
        userObj.tags.forEach(tag => {
            tagsArray.encodeStringValueInHomogenousArray(tag)
        })
        userVBIN.finalizeHomogenousStringArray(5, tagsArray)
        usersArray.finalizeObjectInHomogenousArray(userVBIN)
    })
    rootObj.finalizeHomogenousObjectArray(1, usersArray)
    rootWriter.finalizeRootObject(rootObj)
    return rootWriter.toUint8ArrayAndRelease()
}

const BigObjTypeUsersMapper: VBINObjectMapper = {
    assignValue: function (object: any, keyID: number, value: any): void {
        switch(keyID) {
            case 1: {
                if (typeof value !== 'number') {
                    throw Error('Invalid value type for id field')
                }
                object.id = value
            break
            }
            case 2: {
                if (typeof value !== 'string') {
                    throw Error('Invalid value type for name field')
                }
                object.name = value
            break
            }
            case 3: {
                if (typeof value !== 'boolean') {
                    throw Error('Invalid value type for active field')
                }
                object.active = value
            break
            }
            case 4: {
                if (typeof value !== 'number') {
                    throw Error('Invalid value type for score field')
                }
                object.score = value
            break
            }
            case 5: {
                if (Array.isArray(value) === false) {
                    throw Error('Invalid value type for tags field')
                }
                object.tags = value
            }
        }
    },
    hasAllRequiredFields: function (object: any): boolean {
        if (object.id === undefined) {
            console.log("id not defined")
            return false
        }
        if (object.name === undefined) {
            console.log("name not defined")
            return false
        }
        if (object.active === undefined) {
            console.log("active not defined")
            return false
        }
        if (object.score === undefined) {
            console.log("score not defined")
            return false
        }
        if (object.tags === undefined) {
            console.log("tags not defined")
            return false
        }
        return true
    },
    fieldMapper: function (_keyID: number): VBINObjectMapper | undefined {
        return undefined
    }
}

const BigObjTypeMapper: VBINObjectMapper = {
    assignValue: function (object: any, keyID: number, value: any): void {
        switch(keyID) {
            case 1: {
                if (Array.isArray(value) === false) {
                    throw Error('Invalid value type for users field')
                }
                object.users = value
            break
            }
        }
    },
    hasAllRequiredFields: function (object: any): boolean {
        if (object.users === undefined) {
            console.log("users not defined")
            return false
        }
        return true
    },
    fieldMapper: function (keyID: number): VBINObjectMapper | undefined {
        switch(keyID) {
            case 1:
                return BigObjTypeUsersMapper
        }
        return undefined
    }
}

describe('test vson encoding and decoding', () => {

    const itWrap = (value: JSONValue, name: string, expectedRoundTripValue?: any, encodingFormat?: EncodingFormat) => {
        it({name,
            fn: () => {
                try {
                    // JSON UTF-8 encoded string for comparison
                    const jsonString = (value === undefined) ? "undefined" : JSON.stringify(value)
                    const encoder = new TextEncoder()
                    const jsonUtf8Bytes: Uint8Array = encoder.encode(jsonString)

                    const encoded = VSON.encode(value, encodingFormat)
                    const decoded = VSON.decode(encoded)
                    const encoded_browser = (value !== null && typeof value == "object" || Array.isArray(value)) ? VSON_browser.encode(value) : null
                    const decoded_browser = (encoded_browser !== null) ? VSON_browser.decode(encoded_browser) : null
                    if (expectedRoundTripValue === undefined && !deepEqual(decoded, value, false) && !deepEqual(decoded_browser, value, false)) {
                        console.error('Expected:', jsonString, value)
                        console.error('Encoded:', encoded)
                        console.error('Encoded_browser:', encoded_browser)
                        console.error('Actual decoded:  ', JSON.stringify(decoded), decoded)
                        console.error('Actual decoded_browser:  ', JSON.stringify(decoded_browser), decoded_browser)
                        fail(`ERROR: ${name} failed round-trip`)
                    } else if (expectedRoundTripValue !== undefined && !deepEqual(decoded, expectedRoundTripValue, true) && !deepEqual(decoded_browser, expectedRoundTripValue, true)) {
                        console.error('Expected:', JSON.stringify(expectedRoundTripValue), expectedRoundTripValue)
                        console.error('Encoded:', encoded)
                        console.error('Encoded_browser:', encoded_browser)
                        console.error('Actual decoded:  ', JSON.stringify(decoded), decoded)
                        console.error('Actual decoded_browser:  ', JSON.stringify(decoded_browser), decoded_browser)
                        fail(`ERROR: ${name} failed explicit round-trip`)
                    } else if (encodingFormat === EncodingFormat.KeyTable && encoded_browser !== null && encoded.length !== encoded_browser.length) {
                        // Note that this case only works at the moment because `itWrap()` is not used in cases
                        // that trigger automatic Array homogeniety detection (browser code does not detect that case)
                        fail(`ERROR: ${name} browser encoded to a different length`)
                    } else {
                        if (encoded.length < jsonUtf8Bytes.length) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${jsonUtf8Bytes.length - encoded.length} fewer bytes ${Math.floor(100*(jsonUtf8Bytes.length - encoded.length)/jsonUtf8Bytes.length)}%)`)
                        } else if (encoded.length == jsonUtf8Bytes.length) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - same bytes)`)
                        } else if (encoded.length - jsonUtf8Bytes.length == 1) {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${encoded.length - jsonUtf8Bytes.length} MORE byte ${Math.floor(100*(encoded.length - jsonUtf8Bytes.length)/jsonUtf8Bytes.length)}%)`)
                        } else {
                            console.log(`OK  ${name.padEnd(28)} (${encoded.length} vson bytes - ${jsonUtf8Bytes.length} json bytes - ${encoded.length - jsonUtf8Bytes.length} MORE bytes ${Math.floor(100*(encoded.length - jsonUtf8Bytes.length)/jsonUtf8Bytes.length)}%)`)
                        }
                    }
                } catch (e) {
                    console.log("Exception", e)
                    fail("ERROR: Thrown exception")
                }
            }
        })
    }
    const itBinaryWrap = (value: JSONValue, name: string, expectedBinaryValue: number[], encodingFormat: EncodingFormat) => {
        it({name,
            fn: () => {
                try {
                    const encoded = VSON.encode(value, encodingFormat)
                    const encodedArray = Array.from(encoded)
                    if (!deepEqual(encodedArray, expectedBinaryValue, true)) {
                        const jsonValue = JSON.stringify(value)
                        console.error('Expected:', expectedBinaryValue), expectedBinaryValue.length
                        console.error('Actual:  ', encodedArray, encodedArray.length)
                        console.error('JSON: ', jsonValue, jsonValue.length)
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
    const itBinaryVBINWrap = (value: BigObjType, name: string, expectedRoundTripVSONValue?: any, expectedBinaryValue?: number[]) => {
        it({name,
            fn: () => {
                try {
                    const jsonCompare = JSON.stringify(value)
                    const encoded = encodeBigObj(value)
                    const encodedArray = Array.from(encoded)
                    const vbinDecode = VBIN.decode(encoded, BigObjTypeMapper)
                    const vsonDecode = VSON.decode(encoded)
                    const vsonCompare = VSON.encode(value)
                    if (expectedBinaryValue !== undefined && !deepEqual(encodedArray, expectedBinaryValue, true)) {
                        console.error('Actual:  ', encodedArray)
                        console.error('VSON:    ', JSON.stringify(vsonDecode))
                        console.error('VBIN:    ', JSON.stringify(vbinDecode))
                        fail(`ERROR: ${name} failed VBIN binary encoding`)
                    } else if (expectedRoundTripVSONValue !== undefined && !deepEqual(vsonDecode, expectedRoundTripVSONValue, true)) {
                        console.error('Expected:', expectedRoundTripVSONValue)
                        console.error('Actual:  ', vsonDecode)
                        console.error('VSON:    ', JSON.stringify(vsonDecode))
                        console.error('VBIN:    ', JSON.stringify(vbinDecode))
                        fail(`ERROR: ${name} failed VBIN->VSON round trip encoding`)
                    } else {
                        console.log(`OK  ${name.padEnd(28)} ${encoded.length} VBIN bytes vs ${vsonCompare.length} vson bytes vs ${jsonCompare.length} json bytes (${jsonCompare.length - encoded.length} fewer than json ${encoded.length - vsonCompare.length} vs vson)`)
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
    itWrap([], 'empty array - Base', [], EncodingFormat.Base)
    itWrap([], 'empty array - KeyTable', [], EncodingFormat.KeyTable)
    itWrap([1, 2, 3], 'flat array - Base', [1, 2, 3], EncodingFormat.Base)
    itWrap([1, 2, 3], 'flat array - KeyTable', [1, 2, 3], EncodingFormat.KeyTable)
    itWrap([1, undefined as any, 2, 3], 'flat array with undefined - Base', [1, null as any, 2, 3], EncodingFormat.Base)
    itWrap([1, undefined as any, 2, 3], 'flat array with undefined - KeyTable', [1, null as any, 2, 3], EncodingFormat.KeyTable)
    itWrap([1, 'two', true, null, 3.5, [4, 5]], 'mixed nested array - Base', [1, 'two', true, null, 3.5, [4, 5]], EncodingFormat.Base)
    itWrap([1, 'two', true, null, 3.5, [4, 5]], 'mixed nested array - KeyTable', [1, 'two', true, null, 3.5, [4, 5]], EncodingFormat.KeyTable)

    // Objects
    itWrap({}, 'empty object - Base', {}, EncodingFormat.Base)
    itWrap({}, 'empty object - KeyTable', {}, EncodingFormat.KeyTable)
    itWrap({ a: 1, b: 'two', c: null, d: true }, 'flat object - Base', { a: 1, b: 'two', c: null, d: true }, EncodingFormat.Base)
    itWrap({ a: 1, b: 'two', c: null, d: true }, 'flat object - KeyTable', { a: 1, b: 'two', c: null, d: true }, EncodingFormat.KeyTable)
    const protoObject = Object.create(null)
    protoObject.a = 1
    protoObject.b = 'two'
    protoObject.c = undefined
    protoObject.__proto__ = "test __proto__"
    protoObject.prototype = "test prototype"
    protoObject.constructor = "test constructor"
    protoObject.d = null
    itWrap(protoObject, 'flat object with restricted keys - Base', protoObject, EncodingFormat.Base)
    itWrap(protoObject, 'flat object with restricted keys - KeyTable', protoObject, EncodingFormat.KeyTable)
    const nestedObject = {
        name: 'velojson',
        version: 1,
        tags: ['binary', 'json', 'wire-format'],
        meta: { author: 'test', stable: false, ratio: -0.5 },
    }
    itWrap(nestedObject, 'nested object - KeyTable', nestedObject, EncodingFormat.KeyTable)

    const bigShort = {
        users: Array.from({ length: 2 }, (_, i) => ({
            id: i,
            name: `user_${i}`,
            active: i % 2 === 0,
            score: i * 1.5,
            tags: i % 3 === 0 ? ['vip', 'early'] : [],
        }))
    }
    const big = {
        users: Array.from({ length: 50 }, (_, i) => ({
            id: i,
            name: `user_${i}`,
            active: i % 2 === 0,
            score: i * 1.5,
            tags: i % 3 === 0 ? ['vip', 'early'] : [],
        }))
    }
    const bigVSON = {
        "1": Array.from({ length: 50 }, (_, i) => ({
            "1": i,
            "2": `user_${i}`,
            "3": i % 2 === 0,
            "4": i * 1.5,
            "5": i % 3 === 0 ? ['vip', 'early'] : [],
        }))
    }
    itBinaryVBINWrap(bigShort, "VBIN object encoding - short", {"1":[{"1":0,"2":"user_0","3":true,"4":0,"5":["vip","early"]},{"1":1,"2":"user_1","3":false,"4":1.5,"5":[]}]}, [22, 54, 15, 105, 6, 26, 11, 0, 21, 6, 117, 115, 101, 114, 95, 48, 26, 35, 0, 47, 23, 5, 3, 118, 105, 112, 5, 101, 97, 114, 108, 121, 23, 11, 1, 21, 6, 117, 115, 101, 114, 95, 49, 25, 36, 0, 0, 0, 0, 0, 0, 248, 63, 47, 3, 5])
    itBinaryVBINWrap(big, "VBIN object encoding - longer", bigVSON)

    // Larger structural test
    itWrap(big, 'larger structure (50 users) - Base', big, EncodingFormat.Base)
    itWrap(big, 'larger structure (50 users) - KeyTable', big, EncodingFormat.KeyTable)

    itBinaryWrap({ a: 1 }, "Simple object encoding - Base", [6, 3, 11, 97, 1], EncodingFormat.Base)
    itBinaryWrap({ a: 1 }, "Simple object encoding - KeyTable", [14, 2, 11, 1, 2, 1, 97], EncodingFormat.KeyTable)
    itBinaryWrap({ a: 1, b: 'two', c: true, d: null }, 'flat object encoding - Base', [6, 13, 11, 97, 1, 13, 98, 3, 116, 119, 111, 10, 99, 8, 100], EncodingFormat.Base)
    itBinaryWrap({ a: 1, b: 'two', c: true, d: null }, 'flat object encoding - KeyTable', [14, 9, 11, 1, 21, 3, 116, 119, 111, 26, 32, 8, 1, 97, 1, 98, 1, 99, 1, 100], EncodingFormat.KeyTable)
    itBinaryWrap([1, undefined as any, 2, 3], 'flat arrayencoding - Base', [7, 14, 3, 1, 0, 3, 2, 3, 3], EncodingFormat.Base)
    itBinaryWrap([1, undefined as any, 2, 3], 'flat arrayencoding - KeyTable', [15, 14, 3, 1, 0, 3, 2, 3, 3, 0], EncodingFormat.KeyTable)

    // Larger structural test
    const bigTricky = {
        users: Array.from({ length: 10 }, (_, i) => ({
            id: i,
            name: `user_${i}`,
            active: i % 2 === 0,
            score: i * 1.5,
            score_history: Array.from({ length: 10000 }, (_, index) => index * 1.223791432122),
            tags: i % 3 === 0 ? ['vip', 'early'] : [],
        })),
    }
    const iterations = 50
    it({
        name: "VSON Faster than JSON.parse(JSON.stringify(obj)) for an object with many tricky numbers",
        fn: () => {
            try {
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
                    const obj = VSON.decode(VSON.encode(bigTricky, EncodingFormat.KeyTable))
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: VSON failed to be faster than JSON.parse(JSON.stringify()) VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  (${Math.floor(timeVSON - timeJSON)} faster than JSON.parse(JSON.stringify()) after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "VSON Faster than JSON.stringify(obj) for an object with many tricky numbers",
        fn: () => {
            try {
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
                    const str = VSON.encode(bigTricky, EncodingFormat.KeyTable)
                    totalVLen += str.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.stringify(obj)".padEnd(28)} failed to be faster than JSON.stringify() VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen}`)
                } else {
                    console.log(`OK  ${"JSON.stringify(obj)".padEnd(28)} (${Math.floor(timeVSON - timeJSON)} faster than JSON.stringify() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen})`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "VSON Faster than JSON.parse(obj) for an object with many tricky numbers",
        fn: () => {
            try {
                const strObj = JSON.stringify(bigTricky)
                const startJSON = performance.now()
                let totalLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = JSON.parse(strObj)
                    totalLen += obj.users.length
                }
                const endJSON = performance.now()
                const timeJSON = endJSON - startJSON

                const binObj = VSON.encode(bigTricky, EncodingFormat.KeyTable)
                const startVSON = performance.now()
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = VSON.decode(binObj) as any
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.parse(obj)".padEnd(28)} failed to be faster than JSON.parse() VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  ${"JSON.parse(obj)".padEnd(28)} (${Math.floor(timeVSON - timeJSON)} faster than JSON.parse() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "VBIN Faster than JSON.parse(JSON.stringify(obj)) for an object with many tricky numbers",
        fn: () => {
            try {
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
                    const obj = VBIN.decode(encodeBigObj(bigTricky), BigObjTypeMapper)
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: VSON failed to be faster than JSON.parse(JSON.stringify()) VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  (${Math.floor(timeVSON - timeJSON)} faster than JSON.parse(JSON.stringify()) after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "VBIN Faster than JSON.stringify(obj) for an object with many tricky numbers",
        fn: () => {
            try {
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
                    const str = encodeBigObj(bigTricky)
                    totalVLen += str.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.stringify(obj)".padEnd(28)} failed to be faster than JSON.stringify() VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen}`)
                } else {
                    console.log(`OK  ${"JSON.stringify(obj)".padEnd(28)} (${Math.floor(timeVSON - timeJSON)} faster than JSON.stringify() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} Vlen: ${totalVLen} Jlen: ${totalJLen})`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
    it({
        name: "VBIN Faster than JSON.parse(obj) for an object with many tricky numbers",
        fn: () => {
            try {
                const strObj = JSON.stringify(bigTricky)
                const startJSON = performance.now()
                let totalLen = 0
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = JSON.parse(strObj)
                    totalLen += obj.users.length
                }
                const endJSON = performance.now()
                const timeJSON = endJSON - startJSON

                const binObj = encodeBigObj(bigTricky)
                const startVSON = performance.now()
                for (let i: number = 1; i <= iterations; i++) {
                    const obj = VBIN.decode(binObj, BigObjTypeMapper)
                    totalLen += obj.users.length
                }
                const endVSON = performance.now()
                const timeVSON = endVSON - startVSON

                if (timeVSON > timeJSON) {
                    fail(`ERROR: ${"JSON.parse(obj)".padEnd(28)} failed to be faster than JSON.parse() VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen})`)
                } else {
                    console.log(`OK  ${"JSON.parse(obj)".padEnd(28)} (${Math.floor(timeVSON - timeJSON)} faster than JSON.parse() after ${iterations} iterations, VSON time: ${timeVSON} JSON time: ${timeJSON} (ignore: ${totalLen}))`)
                }
            } catch (e) {
                console.log("Exception", e)
                fail("ERROR: Thrown exception")
            }
        }
    })
})
