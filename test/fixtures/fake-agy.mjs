#!/usr/bin/env node
// Fake Antigravity CLI used by the run-layer tests. It emits the same NDJSON
// event shape as `agy --print --output-format stream-json`, for scenarios the
// tests need to control deterministically.
const scenario = process.argv[2] ?? 'success'

function emit(event) {
    process.stdout.write(`${JSON.stringify(event)}\n`)
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

const init = { event: 'init', conversation_id: 'fake', init: { model: 'fs', cwd: process.cwd(), tools: [] } }
emit(init)
emit({ event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } })

switch (scenario) {
    case 'success': {
        emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'PO' } })
        emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'NG' } })
        emit({ event: 'result', result: { status: 'SUCCESS', response: 'PONG', num_turns: 1 } })
        break
    }
    case 'response-only': {
        emit({ event: 'result', result: { status: 'SUCCESS', response: 'done from response', num_turns: 1 } })
        break
    }
    case 'empty-success': {
        emit({ event: 'result', result: { status: 'SUCCESS', response: '', num_turns: 1 } })
        break
    }
    case 'failure': {
        emit({ event: 'result', result: { status: 'FAILURE', response: 'partial', num_turns: 1 } })
        break
    }
    case 'refusal': {
        emit({ event: 'result', result: { status: 'REFUSAL', response: '', num_turns: 1 } })
        break
    }
    case 'max-tokens': {
        emit({ event: 'result', result: { status: 'MAX_TOKENS', response: 'partial', num_turns: 1 } })
        break
    }
    case 'cancelled': {
        emit({ event: 'result', result: { status: 'CANCELLED', response: '', num_turns: 1 } })
        break
    }
    case 'denied': {
        emit({ event: 'result', result: { status: 'SUCCESS', response: '', num_turns: 1, denied_actions: [{ action: 'write_file', display_name: 'WriteToFile' }] } })
        break
    }
    case 'garbage': {
        process.stdout.write('not json\n')
        process.stdout.write('{"event":\n')
        break
    }
    case 'no-result': {
        emit({ event: 'step_update', step_update: { step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'partial answer' } })
        break
    }
    case 'slow-success': {
        await sleep(1500)
        emit({ event: 'result', result: { status: 'SUCCESS', response: 'slow but done', num_turns: 1 } })
        break
    }
    case 'sleep': {
        await sleep(60_000)
        break
    }
    default: {
        emit({ event: 'result', result: { status: 'FAILURE', response: `unknown scenario ${scenario}`, num_turns: 1 } })
    }
}

process.exit(0)
