#!/usr/bin/env node
import { main } from '../lib/cli/main.mjs'
import { reportError } from '../lib/cli/output.mjs'

main(process.argv.slice(2)).catch((error) => {
  reportError(error, process.argv.includes('--json'))
})
