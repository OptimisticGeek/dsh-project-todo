/**
 * Zero-dependency argument parser for `ptodo`.
 *
 * Supports `--key value`, `--key=value`, boolean flags and repeated flags
 * (returned as arrays, e.g. `--tag KB --tag AGENT`).
 */
export function parseArgs(argv) {
  const flags = {}
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') {
      rest.push(...argv.slice(index + 1))
      break
    }
    if (typeof token === 'string' && token.startsWith('--') && token.length > 2) {
      const equals = token.indexOf('=')
      const key = equals >= 0 ? token.slice(2, equals) : token.slice(2)
      let value
      if (equals >= 0) {
        value = token.slice(equals + 1)
      } else {
        const next = argv[index + 1]
        if (next !== undefined && !(typeof next === 'string' && next.startsWith('--'))) {
          value = next
          index += 1
        } else {
          value = true
        }
      }
      if (key in flags) {
        const previous = flags[key]
        flags[key] = Array.isArray(previous) ? [...previous, value] : [previous, value]
      } else {
        flags[key] = value
      }
      continue
    }
    rest.push(token)
  }
  return { command: rest[0], args: rest.slice(1), flags }
}

/** Last value of a possibly repeated flag. */
export function one(value) {
  return Array.isArray(value) ? value[value.length - 1] : value
}

/** All values of a possibly repeated flag. */
export function many(value) {
  if (value === undefined || value === true) return []
  return (Array.isArray(value) ? value : [value]).map(String)
}

/** A boolean flag: `--force`, `--force=true`. */
export function bool(value) {
  return value === true || value === 'true' || value === '1'
}

/** Comma-separated or repeated list flag. */
export function list(value) {
  return many(value)
    .flatMap((item) => String(item).split(/[,，、;；]/))
    .map((item) => item.trim())
    .filter(Boolean)
}
