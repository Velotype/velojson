// deno-lint-ignore-file no-explicit-any

/** Structural equality that treats `undefined` object values as absent unless `strict` is set. */
export function deepEqual(a: unknown, b: unknown, strict: boolean): boolean {
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
