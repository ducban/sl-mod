import type { Register } from 'claude-code'

// Step 1 of the status-line mod: find out what the engine actually reports,
// before anything is drawn.
//
// Why this exists. The documented rate-limit kinds are `five_hour`,
// `seven_day` and a gateway's `spend_limit`, and on that basis a per-model
// window looked impossible. It is not: `/usage` on this machine shows
// "Current week (Fable) 25% used" beside the session and all-models windows,
// and the 2.1.289 binary carries nine kind strings, not three --
// `seven_day_opus`, `seven_day_sonnet`, `seven_day_overage_included` and more.
// The engine titles those windows from `scope.model.display_name`, a field the
// mods API type does not declare.
//
// So one question is left, and no static source settles it: does
// `$.session.usage().rateLimits` carry the per-model windows, and under what
// `kind`? This command answers it by printing what comes back, untouched. It
// draws nothing and changes nothing.

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sl-debug',
      description: 'Print the raw session usage the status line would read',
    })

    return next(e)
  })

  on('command.run', { command: 'sl-debug' }, async $ => {
    // Read every source the status line is meant to draw from, so one run
    // settles all of them rather than one per round trip.
    const [usage, model, effort, turns] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.env.get('CLAUDE_EFFORT'),
      $.session.turns(),
    ])

    const lines: string[] = []
    const show = (label: string, value: unknown) =>
      lines.push(`${label}: ${JSON.stringify(value, null, 2)}`)

    // The answer to the open question comes first: how many windows, and
    // whether a Fable one is among them.
    lines.push(`rateLimits: ${usage.rateLimits.length} entry(s)`)
    usage.rateLimits.forEach((limit, i) => show(`  [${i}]`, limit))

    // Anything the declared type does not mention, in case the runtime value
    // is richer than `{ kind, percentUsed, resetsAt }` -- a `scope` would be
    // the whole answer on its own.
    const declared = new Set(['kind', 'percentUsed', 'resetsAt'])
    const extra = usage.rateLimits.flatMap(limit =>
      Object.keys(limit as Record<string, unknown>).filter(key => !declared.has(key)),
    )
    lines.push(`undeclared keys on rateLimits[]: ${extra.length ? [...new Set(extra)].join(', ') : 'none'}`)

    show('context', usage.context)
    show('cost', usage.cost)
    show('startedAt', usage.startedAt)
    show('model', model)
    show('CLAUDE_EFFORT', effort)
    show('turns', turns)

    return { text: lines.join('\n') }
  })
}
