import { getKeyBytes } from '../src_server/key_cache.ts'
import { textEncoder } from '../src_server/common.ts'
import { describe, it } from "@std/testing/bdd"
import { assertEquals, assertNotStrictEquals, assertStrictEquals, fail } from "@std/assert"

// key_cache.ts implements a hand-rolled O(1) LRU (Map + doubly-linked list)
// that nothing in the main round-trip suite can distinguish from a plain
// "always re-encode" implementation, since both produce byte-identical
// output. The only observable proof of caching/eviction is *object
// reference identity* of the returned Uint8Array: a cache hit returns the
// exact same instance, while a recompute (post-eviction) allocates a new
// one. Every test below relies only on that, plus the KEY_CACHE_LIMIT
// (4096) contract described in the module's own comments — never on the
// module's private state actually being empty when the test starts, since
// other test files sharing this process may have already populated it.
//
// The KEY_CACHE_LIMIT constant itself is a private module const, so it is
// duplicated here from key_cache.ts; if that value ever changes, these
// tests will need the same update.
const KEY_CACHE_LIMIT = 4096

describe('key_cache LRU behavior', () => {

    it('returns byte-correct output and the same reference on a cache hit', () => {
        const key = '__kc_test_hit__'
        const first = getKeyBytes(key)
        const second = getKeyBytes(key)
        assertEquals(Array.from(first), Array.from(textEncoder.encode(key)))
        assertStrictEquals(first, second) // cache hit: identical object, not just equal bytes
    })

    it('produces correct bytes for unicode and empty-string keys', () => {
        for (const key of ['', 'héllo 🌍 世界', 'a'.repeat(500)]) {
            const bytes = getKeyBytes(key)
            assertEquals(Array.from(bytes), Array.from(textEncoder.encode(key)))
        }
    })

    it('evicts the least-recently-used entry once the cache is full', () => {
        // Regardless of what's already in the (shared, process-wide) cache,
        // inserting KEY_CACHE_LIMIT brand-new distinct keys after `victim`
        // is guaranteed to push it out: the cache holds at most
        // KEY_CACHE_LIMIT entries, so at most KEY_CACHE_LIMIT - 1 keys can
        // have been older than `victim` at the moment it was inserted, and
        // each subsequent new key evicts exactly one older survivor before
        // `victim` itself becomes the eviction target.
        const victim = '__kc_test_evict_victim__'
        const originalRef = getKeyBytes(victim)

        for (let i = 0; i < KEY_CACHE_LIMIT; i++) {
            getKeyBytes(`__kc_test_evict_filler_${i}__`)
        }

        const afterFloodRef = getKeyBytes(victim)
        assertNotStrictEquals(originalRef, afterFloodRef, 'victim should have been evicted and recomputed as a new object')
        assertEquals(Array.from(afterFloodRef), Array.from(textEncoder.encode(victim)), 'recomputed bytes must still be correct')
    })

    it('touching a key (re-reading it) refreshes its recency and saves it from eviction', () => {
        // Saturate the cache with exactly KEY_CACHE_LIMIT brand-new keys.
        // This is enough to guarantee the cache now contains *only* these
        // keys (any pre-existing ambient entries get evicted first), so
        // from here the cache's exact contents and LRU order are fully known.
        const warmupRefs: Uint8Array[] = []
        for (let i = 0; i < KEY_CACHE_LIMIT; i++) {
            warmupRefs.push(getKeyBytes(`__kc_test_lru_warmup_${i}__`))
        }

        // warmup[0] is now the least-recently-used entry. Touch it to move
        // it to the most-recently-used end, ahead of warmup[1].
        const touchedRef = getKeyBytes('__kc_test_lru_warmup_0__')
        assertStrictEquals(touchedRef, warmupRefs[0])

        // Insert exactly one new key. With the cache full, this evicts
        // whatever is now the LRU entry — which should be warmup[1], since
        // warmup[0] was just refreshed past it.
        getKeyBytes('__kc_test_lru_new_entry__')

        const warmup0Recheck = getKeyBytes('__kc_test_lru_warmup_0__')
        const warmup1Recheck = getKeyBytes('__kc_test_lru_warmup_1__')

        if (!Object.is(warmup0Recheck, touchedRef)) {
            fail('touched entry (warmup[0]) was evicted even though it was the most recently used')
        }
        if (Object.is(warmup1Recheck, warmupRefs[1])) {
            fail('untouched entry (warmup[1]) survived eviction even though it should have become the LRU victim')
        }
    })
})
