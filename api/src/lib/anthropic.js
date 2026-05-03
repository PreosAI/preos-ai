// Anthropic Messages API client (direct REST, no SDK).
//
// Used by location triangulation (Phase A). Built on the global fetch in
// Node 20+, no extra dependencies. Designed to be called from both the
// deployed Azure Functions runtime and from local test scripts — the only
// requirement is the ANTHROPIC_API_KEY env var.
//
// Caching: Anthropic supports prompt caching via cache_control on a content
// block. We pin the system block as ephemeral cached so a 50-property batch
// pays the system-prompt input cost once, then reads cached on the rest.
// Pricing today: cache write is +25%, cache hit is -90%. Net: cheaper after
// 2 calls in a 5-minute window. We track usage via the response.usage.cache_*
// fields and surface them so callers can audit cost.
//
// Failure policy (per Phase A rules): we throw on any non-2xx response, and
// callers are expected to halt the batch. We do retry once on a network-level
// error (TypeError / fetch reject), with a short backoff. We do NOT retry on
// 4xx or 5xx — those need human attention.

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

function getApiKey() {
    const k = process.env.ANTHROPIC_API_KEY;
    if (!k) throw new Error('ANTHROPIC_API_KEY not set');
    return k;
}

/**
 * Call the Messages API. Returns the parsed JSON response (with usage stats).
 *
 * @param {object}  opts
 * @param {string}  opts.system             System prompt — cached automatically.
 * @param {string}  opts.user               User message text.
 * @param {string}  [opts.model]            Override default Haiku 4.5.
 * @param {number}  [opts.maxTokens=1000]
 * @param {number}  [opts.temperature=0]
 * @param {boolean} [opts.cacheSystem=true] Apply cache_control to the system block.
 * @param {AbortSignal} [opts.signal]       Pass-through abort signal.
 */
async function callMessages(opts) {
    const {
        system,
        user,
        model = DEFAULT_MODEL,
        maxTokens = 1000,
        temperature = 0,
        cacheSystem = true,
        signal
    } = opts || {};

    if (!system || !user) throw new Error('callMessages: system and user are required');

    const systemBlock = cacheSystem
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system;

    const body = {
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemBlock,
        messages: [{ role: 'user', content: user }]
    };

    const headers = {
        'x-api-key': getApiKey(),
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json'
    };

    let res;
    try {
        res = await fetch(MESSAGES_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
    } catch (e) {
        // One retry on network-level error.
        await new Promise(r => setTimeout(r, 500));
        res = await fetch(MESSAGES_URL, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal
        });
    }

    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('Anthropic ' + res.status + ': ' + txt.slice(0, 400));
    }

    const data = await res.json();
    return data;
}

/**
 * Convenience: call Messages and return the assistant text content.
 */
async function callMessagesText(opts) {
    const data = await callMessages(opts);
    const block = (data.content || []).find(c => c.type === 'text');
    if (!block) throw new Error('Anthropic response had no text content: ' + JSON.stringify(data).slice(0, 200));
    return { text: block.text, usage: data.usage || {}, raw: data };
}

/**
 * Strip a markdown code fence from a JSON-ish string. Haiku at temp=0 with a
 * "JSON only" instruction usually returns clean JSON, but occasionally wraps
 * in ```json ... ``` which JSON.parse rejects. Keep this tolerant.
 */
function stripJsonFence(s) {
    if (!s) return s;
    const t = s.trim();
    const m = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return m ? m[1].trim() : t;
}

module.exports = { callMessages, callMessagesText, stripJsonFence, DEFAULT_MODEL };
