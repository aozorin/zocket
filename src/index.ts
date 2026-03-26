import { buildCli } from './cli.js'

buildCli().parseAsync(process.argv).catch(e => {
  console.error(e)
  process.exit(1)
})
